# Lamplight: Porchlight's design system

Light is the interface. In Porchlight, light already means something everywhere: the beacon's LED, the porch lights in the 3D city, the windows that go dark when the grid fails. The interface does not decorate with light; it speaks in it, with one vocabulary from the physical beacon to the screen.

## Colour: every colour has one job

| Token | Hex | Meaning |
| - | - | - |
| night | #0a0d1f | The dark. A deep blue black, never grey |
| porch | #f4b560 | Life, neighbours, the main action. A porch light that is on |
| signal | #ff6a55 | A call for help, and nothing else |
| moon | #9ec5ff | The City, information, the uplink |
| hush | #c6cde6 | A home that has gone silent |
| paper | #f1ebdf | Text |

A possible fall uses the beacon's purple, so the screen matches the countdown on the device. Status is always written in words as well as shown in colour.

## Type

Atkinson Hyperlegible Next, designed by the Braille Institute for readers with low vision, is used for everything. Its companion mono face appears only for machine data such as signatures. The scale is a major third from 15px. Large numerals are set light, headings heavy, and everything is in sentence case.

## Surfaces

Panels are lanterns rather than frosted glass: dark, lit along the top edge, with corner radius that grows with the size of the thing. Buttons are soft rectangles, because they are instruments. The primary action is lit from inside.

## The operations room

The living city fills the room. The calls sit on the left as tickets lit from their left edge in the colour of their status; a home's details slide in on the right only when a home is chosen; the last hour runs along the bottom as one heartbeat line. Every room control lives in one menu, and the one glowing control is the voice copilot.

One moment is orchestrated: the arrival of a call. The edges of the room wash red, a banner springs in with the keys to press, the camera flies to the home, and the call's journey plays across the street. Everything else stays calm.

## Principles

1. Light is the interface: the same colours mean the same things on the beacon, in 3D and in the panels.
2. Quiet by default: panels recede and the city leads.
3. Words for everything: every light also has a label, and the street list is the accessible equivalent of the map.
4. Motion answers people: springs on actions, one orchestrated arrival, and nothing that bounces on its own. Reduced motion is respected everywhere.
5. Fast: it has to hold its frame rate on a laptop driving a projector.

## Where it lives

Tokens are CSS custom properties in apps/city/app/styles/tokens.css. Shared components are in base.css, and the operations room in ops.css. Motion uses the Motion library for React.

## The 3D city

The city is lit like a real night rather than a render. A cool moon rakes the facades from one side and a faint warm bounce rises from the streets. Tower roof lines and corners catch the moonlight, bright at the top and fading toward the street, so buildings read as architecture instead of clouds of windows. Only real light sources bloom, so nothing blows out on a projector.

Every street lamp throws a pool of light on the road, and those pools fade with the grid when the storm crosses the city. Each Porchlight home has a gabled roof and a pool of porch light by its door, coloured by its status. A call for help rises from the home as a soft pillar of light that fades into the sky, instead of a laser.

The camera flies with a slow, symmetrical ease and lifts gently through the middle of each flight. In the operations room it keeps the chosen home centred in the free space between the side panels, and drifts in a very slow orbit while nobody is touching the map. On a slow laptop it steps down to fewer pixels and a cheaper glow on its own.

## The landing page

The landing page is a film you scroll. The 3D city stays fixed behind the page while the scroll drives the camera, the storm and the story, so scrolling back rewinds it. Lenis smooths the scroll. Each chapter card rests in view while the camera moves, so nothing is ever cut off at the edge of the screen.

The one orchestrated moment is the derecho. As the storm front crosses the city and the windows go dark block by block, the page loses power with it: the navigation and the chapter lights dim to almost nothing, and they come back only when the link returns. The chapter rail is a row of porch lights; the chapters you have passed stay warm.

The story covers the whole system in order: the grid, the derecho, the three homes that still glow, one button and fall detection, Porch Circles, the mesh, the link returning, silence as a signal with the beacon's signs of life, Gemini's ranking, the voice call in her own language, and the measured proof.
