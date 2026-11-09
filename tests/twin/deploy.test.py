"""Exercise deployment and rollback entirely in temporary files, without a server."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASE = '80c6fa3b6d706fa93dc1a58ff545757918b763ea'
FILES = subprocess.check_output(['git', 'diff', '--name-only', BASE, 'HEAD', '--', 'site'], cwd=ROOT, text=True).splitlines()


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='knight-deploy-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.site = self.root / 'site'
        self.site.mkdir()
        (self.site / 'knight-eps-phase12/models').mkdir(parents=True)
        self.original = {}
        for file in FILES:
            result = subprocess.run(['git', 'show', f'{BASE}:{file}'], cwd=ROOT, capture_output=True)
            if result.returncode == 0:
                relative = file.removeprefix('site/')
                target = self.site / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(result.stdout)
                self.original[relative] = result.stdout
        (self.root / 'health.json').write_text('{"ok":true}')
        (self.root / 'server.js').write_text('// unchanged backend fixture\n')
        self.environment = dict(os.environ, SITE_ROOT=str(self.site), BACKUP_ROOT=str(self.root / 'backups'),
                                BRIDGE_FILE=str(self.root / 'server.js'), HEALTH_URL=(self.root / 'health.json').as_uri(),
                                SITE_CHECK_URL=(self.site / 'knight-eps-phase12/viewer/index.html').as_uri())
        if shutil.which('sha256sum') is None:
            binary = self.root / 'bin'
            binary.mkdir()
            shim = binary / 'sha256sum'
            shim.write_text('#!/bin/sh\nexec shasum -a 256 "$@"\n')
            shim.chmod(0o755)
            self.environment['PATH'] = str(binary) + os.pathsep + os.environ['PATH']

    def deploy(self, *arguments):
        return subprocess.run(['bash', 'scripts/deploy-detailed-twin.sh', *arguments], cwd=ROOT,
                              env=self.environment, capture_output=True, text=True)

    def snapshot(self):
        return {str(p.relative_to(self.site)): p.read_bytes() for p in self.site.rglob('*') if p.is_file()}

    def test_preflight_does_not_mutate_site(self):
        before = self.snapshot()
        result = self.deploy('--check')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse((self.root / 'backups').exists())

    def test_deployment_is_idempotent_and_leaves_backend_unchanged(self):
        for _ in range(2):
            result = self.deploy()
            self.assertEqual(result.returncode, 0, result.stderr)
            for file in FILES:
                self.assertEqual((self.site / file.removeprefix('site/')).read_bytes(), (ROOT / file).read_bytes())
        self.assertEqual((self.root / 'server.js').read_text(), '// unchanged backend fixture\n')
        self.assertEqual(len(list((self.root / 'backups').glob('*/site-files.tar.gz'))), 2)

    def test_failed_postcheck_restores_backup_and_removes_new_assets(self):
        before = self.snapshot()
        self.environment['SITE_CHECK_URL'] = (self.root / 'missing.html').as_uri()
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('restored site files', result.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_production_drift_refuses_deployment_before_backup(self):
        (self.site / 'index.html').write_text('Production-only edit')
        before = self.snapshot()
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('differs from the inspected base', result.stderr)
        self.assertEqual(self.snapshot(), before)
        self.assertFalse((self.root / 'backups').exists())


if __name__ == '__main__':
    unittest.main()
