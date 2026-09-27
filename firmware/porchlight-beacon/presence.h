// Types shared with Arduino auto-generated prototypes (inserted above the .ino body).
#pragma once

enum class PresenceVerdict { No, Yes, TooDark };

/** Why a moved frame was marked (gyro preferred over acceleration). */
enum class MovedReason { None, Rotation, Acceleration };

/** Confirmed ambient light state after the 5 second stability window. */
enum class LightState { Unknown, Dark, Bright };
