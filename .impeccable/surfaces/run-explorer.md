# Run Explorer surface brief

Mode: Operate

The Run Explorer lets a signed-in team member find a saved run, inspect a chosen measurement over a chosen time window, bind a graph selection to the underlying packets, and understand why the run ended. Operators can start and stop capture without leaving the page.

The visual direction inherits the existing CubeSat PMDS instrument console. The first viewport prioritizes capture status, run search, the selected run, and its timeline. The signature interaction is a selectable graph bucket that narrows the packet table to the exact interval represented by that point. Gold identifies selection and primary actions; green, amber, and red communicate state.

Required states include loading skeletons, no recordings, no samples for a metric, recording unavailable, authentication or permission failure, network retry, active recording, completed and interrupted runs, linked previous and next runs, and narrow-screen composition. Graph selection must work by pointer and keyboard. Tables remain horizontally scrollable and packet details expand inline.
