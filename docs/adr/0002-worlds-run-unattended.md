# ADR 0002: in a cosmos room, worlds run unattended while anyone is here

- Status: accepted; amends [ADR 0001](0001-empty-rooms-pause.md) for cosmos rooms only
- Context: the crit 10 pod prompt (_Rivals under gods_) puts all five worlds in play at once, with players spread across them, and says plainly that "a grove on Mars burns while everyone is on Earth."

## The question

ADR 0001 says a world never advances without its players. In classic that's the same as "a room never advances while it's empty", because the room has one world and everyone is on it. In cosmos the two come apart: four worlds can have nobody standing on them while the fifth is full. Should an unwatched world wait?

## Decision

In a cosmos room every world's economy ticks every economy tick, whether or not anyone is on it, as long as at least one human is connected to the room. When no human is connected, the whole room pauses, bots included: ADR 0001 still holds at room level. Bots never keep a room awake, and the server doesn't run them in a room with no human.

## Alternatives weighed

1. **Pause each world nobody stands on.** Keeps ADR 0001's wording, but it breaks the brief's interdependence: the Foundry's furnaces on Earth would stop browning the land the moment the Foundry flew to the Sun, and a faction could freeze a rival's world just by leaving it. It would also make "whoever burns the Sun powers everyone else's outer worlds" meaningless, since nobody's outer world would run while they were burning it.
2. **Keep the whole room running for bots alone.** Bots would play an abandoned campaign to its end. That is exactly what ADR 0001 was written to prevent: people coming back to worlds spent without them.

## Consequences and costs

- Machines a faction left behind keep working on a world it's no longer on, and so do their costs: smoke, coolant draw, scars. Leaving a world doesn't leave its consequences behind, which is the point.
- One human in a cosmos room keeps four bots and five worlds running. That person can watch the cosmos spend itself; nothing is lost to anyone who wasn't there, because the room pauses the moment the last human goes.
- The tick cost is five worlds instead of one. Measured in [TESTING.md](../TESTING.md#performance): well inside the 100 ms tick.
