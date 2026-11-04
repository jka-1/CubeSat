"""Branch Definition tab: model parity with the web editor, bridge request shapes (revision PUT, 409 conflict,
editor-only login), and the Qt page."""
import io, json, os, urllib.error

import pytest

from cubesat_i2c import sequence_model as M
from cubesat_i2c.wireless_session import WirelessSession, SequenceConflict


class R:
    def __init__(self, b, status=200): self.b, self.status = b, status
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self): return json.dumps(self.b).encode()


def http_error(url, code, body):
    return urllib.error.HTTPError(url, code, "err", {}, io.BytesIO(json.dumps(body).encode()))


def test_user_register_validation_matches_web():
    entry, errors = M.parse_user_register("0x48", "0x01", 2, "little", "Temp")
    assert not errors and entry["addr"] == "0x48" and entry["reg"] == "0x01" and entry["len"] == 2
    for addr in ("0x07", "0x78", "zz"):
        assert M.parse_user_register(addr, "0x00", 1, "big", "")[1]
    assert M.parse_user_register("0x48", "0x100", 1, "big", "")[1]
    assert M.parse_user_register("0x48", "0x00", 3, "big", "")[1]
    assert M.parse_user_register("0x48", "0x00", 1, "middle", "")[1]
    assert M.parse_user_register("0x48", "0x00", 1, "big", "x" * 61)[1]
    d = M.fresh("t")
    for i in range(M.USER_REGISTER_LIMIT):
        e, _ = M.parse_user_register("0x48", "0x%02X" % i, 1, "big", "")
        assert M.add_user_register(d, e)[1] is None
    e, _ = M.parse_user_register("0x49", "0x00", 1, "big", "")
    assert M.add_user_register(d, e)[1]


def test_if_on_block_result_with_mask_validates_and_order_matters():
    d = M.fresh("Mask check")
    read = M.make_block("registerRead"); branch = M.make_block("if")
    branch["condition"] = {"op": "&", "left": {"step": read["id"]}, "right": {"constant": 0x10, "unit": "hex"}}
    branch["then"].append(M.make_block("delay")); branch["else"].append(M.make_block("delay"))
    d["steps"] = [read, branch]
    assert M.validate_draft(d) == []
    assert [s["id"] for s in M.earlier_reads(d["steps"], branch["id"])] == [read["id"]]
    d["steps"] = [branch, read]
    assert M.validate_draft(d)


def test_remote_change_and_clone():
    d = M.fresh("x"); d.update(id="a", revision=2)
    assert M.remote_change(d, [{"id": "a", "revision": 3, "name": "x"}])["revision"] == 3
    assert M.remote_change(d, [{"id": "a", "revision": 2, "name": "x"}]) is None
    c = M.clone_sequence(d)
    assert "id" not in c and "revision" not in c


def test_save_put_with_revision_and_conflict():
    calls = []

    def opener(req, timeout):
        calls.append((req.get_method(), req.full_url, json.loads(req.data or b"{}"), dict(req.header_items())))
        if req.get_method() == "PUT":
            raise http_error(req.full_url, 409, {"error": "stale", "code": "revision_conflict", "current": {"id": "a/b", "revision": 5, "name": "n"}})
        return R({"sequence": {"id": "new", "revision": 1, "name": "n"}}, 201)

    s = WirelessSession("http://bridge.example:8080", token="tok", opener=opener)
    s.csrf = "c"
    assert s.save_sequence({"version": 1, "name": "n", "steps": []})["id"] == "new"
    with pytest.raises(SequenceConflict) as ei:
        s.save_sequence({"version": 1, "id": "a/b", "revision": 4, "name": "n", "steps": []})
    assert ei.value.current["revision"] == 5
    (m1, u1, b1, h1), (m2, u2, b2, h2) = calls
    assert m1 == "POST" and u1.endswith("/sequences") and h1.get("X-csrf-token") == "c"
    assert m2 == "PUT" and u2.endswith("/sequences/a%2Fb") and b2["revision"] == 4
    assert "X-command-token" not in h1  # saving a definition never needs the command token


def test_live_execute_and_resume_carry_command_token_simulation_does_not():
    calls = []

    def opener(req, timeout):
        calls.append((req.full_url, json.loads(req.data or b"{}"), dict(req.header_items())))
        return R({"execution": {"id": "e1", "state": "running"}})

    s = WirelessSession("http://b:1", token="tok", opener=opener)
    s.execute_sequence("s1", "simulation", "x1", telemetry={"pv": {}})
    s.execute_sequence("s1", "live", "x2", confirmation_token="ct")
    s.control_execution("e1", "pause"); s.control_execution("e1", "resume")
    assert "X-command-token" not in calls[0][2] and calls[0][1]["telemetry"] == {"pv": {}}
    assert calls[1][2].get("X-command-token") == "tok" and calls[1][1]["confirmation_token"] == "ct"
    assert "X-command-token" not in calls[2][2] and calls[3][2].get("X-command-token") == "tok"


def test_login_falls_back_to_editor_only_when_another_operator_has_control():
    bodies = []

    def opener(req, timeout):
        body = json.loads(req.data or b"{}"); bodies.append(body)
        if body.get("control") is not False:
            raise http_error(req.full_url, 409, {"error": "Another operator has control"})
        return R({"csrf": "c", "user": {"username": "op", "role": "operator"}, "control_active": False})

    s = WirelessSession("http://b:1", opener=opener)
    s.login("op", "pw")
    assert s.edit_only and not s.control_active and bodies[1]["control"] is False


def test_branch_page_builds_and_edits(qtbot=None):
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication([])
    from cubesat_i2c.branch_page import BranchDefinitionPage
    page = BranchDefinitionPage(); page.show()
    page.block_type.setCurrentIndex(page.block_type.findData("registerRead")); page.add_block()
    page.tree.clearSelection()
    page.block_type.setCurrentIndex(page.block_type.findData("if")); page.add_block()
    steps = page.draft["steps"]
    assert [s["type"] for s in steps] == ["registerRead", "if"]
    # select the IF block; its condition editor offers the earlier read as a block result
    page._select_ref(("block", steps[1]["id"], ()))
    ed = page.editor.cond.left
    ed.kind.setCurrentIndex(ed.kind.findData("step"))
    assert ed.value.currentData() == steps[0]["id"]
    page.editor.cond.op.setCurrentIndex(page.editor.cond.op.findData("&"))
    assert steps[1]["condition"]["op"] == "&" and steps[1]["condition"]["left"] == {"step": steps[0]["id"]}
    r = page.editor.cond.right
    r.unit.setCurrentIndex(r.unit.findData("hex")); r.const.setText("0x10"); r._emit()
    assert steps[1]["condition"]["right"] == {"constant": 16, "unit": "hex"}
    page.block_type.setCurrentIndex(page.block_type.findData("delay"))
    for br in ("then", "else"):
        page._select_ref(("path", steps[1]["id"], ((steps[1]["id"], br),))); page.add_block()
    assert len(steps[1]["then"]) == 1 and len(steps[1]["else"]) == 1
    page.name.setText("T"); page._name_edited("T")
    assert page.errors == [] and not page.save_btn.isEnabled()  # not connected
    page.close()
