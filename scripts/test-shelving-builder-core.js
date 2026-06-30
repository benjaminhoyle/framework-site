const assert = require("assert");
const Core = require("../js/shelving-builder-core.js");

function assertValid(config, label) {
  const result = Core.validateConfig(config);
  assert.strictEqual(result.valid, true, `${label}: ${JSON.stringify(result.errors)}`);
}

function assertInvalid(config, label, text) {
  const result = Core.validateConfig(config);
  assert.strictEqual(result.valid, false, `${label}: expected invalid`);
  if (text) {
    assert(
      result.errors.some((error) => error.message.includes(text)),
      `${label}: expected error containing "${text}", got ${JSON.stringify(result.errors)}`
    );
  }
}

function pattern(config, predicate) {
  return Core.listNextLevelPatterns(config).find(predicate);
}

assertValid(Core.createDemoConfig("standard_stack"), "standard stack");
assertValid(Core.createDemoConfig("slim_gap_bridge"), "slim gap bridge");
assertValid(Core.createDemoConfig("adjacent_pair"), "adjacent pair");
assertValid(Core.createDemoConfig("adapter_booster_slim"), "adapter booster plus slim");

const adjacentPair = Core.createDemoConfig("adjacent_pair");
const adjacentSpans = Core.listSupportSpans(adjacentPair);
assert.strictEqual(
  adjacentSpans.some((span) => span.kind === "gap"),
  false,
  "adjacent bases must not produce a bridge gap"
);

const adjacentSockets = Core.collectTopSockets(Core.layoutConfig(adjacentPair).modules);
const seamSockets = adjacentSockets.filter((socket) => socket.x === 703 && socket.z === 430);
assert.strictEqual(seamSockets.length, 2, "adjacent bases keep two owned seam sockets");
assert.notStrictEqual(seamSockets[0].id, seamSockets[1].id, "seam sockets are not merged");

let slimGap = Core.createConfig([
  Core.createBaseSlot("standard_base", { id: "left_base" }),
  Core.createBaseSlot("standard_base", { id: "right_base", gapBefore: "slim_gap" })
]);
const slimBridge = pattern(slimGap, (candidate) => (
  candidate.modules.length === 1 &&
  candidate.modules[0].type === "slim_extension" &&
  candidate.id.includes(":gap:")
));
assert(slimBridge, "slim gap should generate slim bridge pattern");
slimGap = Core.applyPattern(slimGap, slimBridge);
assertValid(slimGap, "applied slim bridge");

const illegalReuse = Core.createConfig([
  Core.createBaseSlot("standard_base", { id: "left_base" }),
  Core.createBaseSlot("standard_base", { id: "right_base", gapBefore: "slim_gap" })
]);
const supportSpans = Core.listSupportSpans(illegalReuse);
const leftOwned = supportSpans.find((span) => span.kind === "owned" && span.owners[0] === "left_base");
const gap = supportSpans.find((span) => span.kind === "gap" && span.spanName === "slim");
const run = illegalReuse.runs[0];
run.levels.push({
  id: "bad_level",
  label: "Bad socket reuse",
  modules: [
    {
      id: "standard_left",
      type: "standard_extension",
      x: leftOwned.x0,
      supportSocketIds: leftOwned.socketIds
    },
    {
      id: "slim_bridge",
      type: "slim_extension",
      x: gap.x0,
      supportSocketIds: gap.socketIds
    }
  ]
});
assertInvalid(illegalReuse, "socket reuse", "consumed more than once");

let adapterConfig = Core.createConfig([
  Core.createBaseSlot("wide_base", { id: "wide_base" })
]);
const adapter = pattern(adapterConfig, (candidate) => (
  candidate.modules.length === 1 && candidate.modules[0].type === "wide_adapter"
));
assert(adapter, "wide base should allow wide adapter");
adapterConfig = Core.applyPattern(adapterConfig, adapter);
const boosterSlim = pattern(adapterConfig, (candidate) => {
  const types = candidate.modules.map((module) => module.type).sort();
  return types.join("+") === "slim_extension+standard_booster";
});
assert(boosterSlim, "wide adapter should allow booster + slim combo");
adapterConfig = Core.applyPattern(adapterConfig, boosterSlim);
assertValid(adapterConfig, "booster plus slim on adapter");
const wideOverSplit = pattern(adapterConfig, (candidate) => (
  candidate.modules.length === 1 &&
  candidate.modules[0].type === "wide_extension" &&
  candidate.id.includes("composite")
));
assert(wideOverSplit, "booster plus slim should expose a wide composite bridge");
const adapterOverBooster = pattern(adapterConfig, (candidate) => (
  candidate.modules.length === 1 &&
  candidate.modules[0].type === "wide_adapter" &&
  candidate.id.includes("composite")
));
assert.strictEqual(adapterOverBooster, undefined, "wide adapter cannot sit over a booster-supported composite span");

const standardSlim = pattern(Core.applyPattern(Core.createConfig([
  Core.createBaseSlot("wide_base", { id: "wide_base" })
]), adapter), (candidate) => {
  const types = candidate.modules.map((module) => module.type).sort();
  return types.join("+") === "slim_extension+standard_extension";
});
assert.strictEqual(standardSlim, undefined, "standard + slim should not be generated because it reuses adapter middle socket");

let boosterStack = Core.createConfig([
  Core.createBaseSlot("standard_base", { id: "standard_base" })
]);
const firstBooster = pattern(boosterStack, (candidate) => (
  candidate.modules.length === 1 &&
  candidate.modules[0].type === "standard_booster" &&
  candidate.modules[0].supportSocketIds.includes("standard_base:top:0")
));
assert(firstBooster, "first booster should be allowed");
boosterStack = Core.applyPattern(boosterStack, firstBooster);
const secondBooster = pattern(boosterStack, (candidate) => (
  candidate.modules.length === 1 && candidate.modules[0].type === "standard_booster"
));
assert(secondBooster, "second booster should be allowed");
boosterStack = Core.applyPattern(boosterStack, secondBooster);
const thirdBooster = pattern(boosterStack, (candidate) => (
  candidate.modules.length === 1 && candidate.modules[0].type === "standard_booster"
));
assert.strictEqual(thirdBooster, undefined, "third stacked booster should not be allowed");

const standardStack = Core.createDemoConfig("standard_stack");
const middleReplacements = Core.listReplacementPatterns(standardStack, 1);
assert(
  middleReplacements.some((candidate) => (
    candidate.modules.length === 1 && candidate.modules[0].type === "standard_extension"
  )),
  "middle standard level can be replaced by a compatible standard level"
);
assert.strictEqual(
  middleReplacements.some((candidate) => (
    candidate.modules.length === 1 && candidate.modules[0].type === "standard_booster"
  )),
  false,
  "middle level cannot cycle to a single booster when an upper shelf depends on a full span"
);
const topReplacements = Core.listReplacementPatterns(standardStack, 2);
assert(
  topReplacements.some((candidate) => candidate.modules.some((module) => module.type === "standard_booster")),
  "top level can cycle to booster because nothing sits above it"
);

console.log("shelving builder level grammar tests passed");
