// Presence check verdict. Lives in a header so Arduino's auto-generated
// function prototypes (inserted above the .ino body) can see the type.
#pragma once

enum class PresenceVerdict { No, Yes, TooDark };
