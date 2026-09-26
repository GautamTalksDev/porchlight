import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNeighbourThread } from "../lib/circles.ts";

describe("buildNeighbourThread", () => {
  it("orders replies oldest first and maps codes to labels", () => {
    const thread = buildNeighbourThread(
      [
        {
          id: "b".repeat(64),
          at: "000001700000000.000002.aaaaaaaaaaaaaaaa",
          origin: "bbbbbbbbbbbbbbbb",
          actor: "hh-birch-4",
          reply: "cant",
          note: "roads iced",
        },
        {
          id: "a".repeat(64),
          at: "000001600000000.000001.aaaaaaaaaaaaaaaa",
          origin: "aaaaaaaaaaaaaaaa",
          actor: "hh-elm-7",
          reply: "omw",
        },
      ],
      (id) => (id === "hh-elm-7" ? "7 Elm Court" : id === "hh-birch-4" ? "4 Birch Lane" : id),
    );
    assert.equal(thread.length, 2);
    assert.equal(thread[0]!.actorLabel, "7 Elm Court");
    assert.equal(thread[0]!.replyLabel, "On my way");
    assert.equal(thread[0]!.replyCode, "omw");
    assert.equal(thread[1]!.actorLabel, "4 Birch Lane");
    assert.equal(thread[1]!.replyLabel, "Can't go");
    assert.equal(thread[1]!.note, "roads iced");
    assert.ok(thread[0]!.atMs < thread[1]!.atMs);
  });

  it("returns an empty list when nobody has replied", () => {
    assert.deepEqual(buildNeighbourThread([], (id) => id), []);
  });
});
