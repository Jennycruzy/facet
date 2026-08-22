import { describe, expect, it } from "vitest";
import {
  buildGateAActionSet,
  supportsRegistration,
  GATE_A_REGISTRATION_OPTIONS,
  type PrivacyBuilderLike,
  type PrivacyClientLike,
  type PrivacyCall,
} from "../src/index.js";

class FakeTokenBuilder {
  constructor(private readonly owner: FakeBuilder, private readonly token: string) {}

  createOpenNote(): PrivacyBuilderLike {
    this.owner.actions.push({ type: "transfer", token: this.token, amount: "OPEN" });
    return this.owner;
  }

  withdraw(args: { amount: string; recipient: string }): PrivacyBuilderLike {
    this.owner.actions.push({ type: "withdraw", token: this.token, ...args });
    return this.owner;
  }
}

class FakeBuilder implements PrivacyBuilderLike {
  readonly actions: unknown[] = [];
  readonly addressLookups: unknown[] = [];
  readonly invokes: unknown[] = [];
  readonly account = { nonce: 0n, address: 0xabcden, is_deployed: false };

  with(token: string): FakeTokenBuilder {
    return new FakeTokenBuilder(this, token);
  }

  shadowAccounts(dappName: string) {
    return {
      addresses: async (range?: unknown) => {
        this.addressLookups.push({ dappName, range });
        return [this.account];
      },
      invoke: (nonce: string, options: { calls: PrivacyCall[]; collectPolicy?: unknown }) => {
        this.invokes.push({ nonce, options });
        return this;
      },
    };
  }
}

class FakeRegistrableBuilder extends FakeBuilder {
  register(): this {
    this.actions.push({ type: "setViewingKey" });
    return this;
  }
}

function fixture() {
  const builder = new FakeBuilder();
  const client: PrivacyClientLike = { build: () => builder };
  return { builder, client };
}

function registrableFixture() {
  const builder = new FakeRegistrableBuilder();
  const client: PrivacyClientLike = { build: () => builder };
  return { builder, client };
}

const baseOptions = {
  token: 0x55n,
  amount: 0x10n,
  dappName: "strk",
  nonce: 0n,
  calls: [{ contractAddress: "0x123", entrypoint: "balance_of", calldata: ["0x456"] }],
};

describe("buildGateAActionSet", () => {
  it("resolves the authoritative address and queues one ordered operation", async () => {
    const { builder, client } = fixture();
    const calls: PrivacyCall[] = [
      { contractAddress: "0x123", entrypoint: "balance_of", calldata: ["0x456"] },
    ];

    const result = await buildGateAActionSet(client, {
      token: 0x55n,
      amount: 0x10n,
      dappName: "strk",
      nonce: 0n,
      calls,
    });

    expect(result.shadowAccount.address).toBe(0xabcden);
    expect(result.token).toBe("0x55");
    expect(result.amount).toBe("0x10");
    expect(builder.addressLookups).toEqual([
      { dappName: "strk", range: { start: 0, end: 1, untilUndeployed: false } },
    ]);
    expect(builder.actions).toEqual([
      { type: "transfer", token: "0x55", amount: "OPEN" },
      { type: "withdraw", token: "0x55", amount: "0x10", recipient: "0xabcde" },
    ]);
    expect(builder.invokes).toEqual([
      {
        nonce: "0x0",
        options: { calls, collectPolicy: { type: "all" } },
      },
    ]);
    expect(calls).toEqual([
      { contractAddress: "0x123", entrypoint: "balance_of", calldata: ["0x456"] },
    ]);
  });

  it("normalizes exact collection amounts and rejects missing accounts", async () => {
    const { client } = fixture();
    const result = await buildGateAActionSet(client, {
      token: "0x55",
      amount: "16",
      dappName: "strk",
      nonce: 0,
      calls: [{ contractAddress: "0x1", entrypoint: "balance_of", calldata: [] }],
      collectPolicy: { type: "exact", amount: 2n },
    });
    expect(result).toBeDefined();
  });

  it.each([
    ["empty dapp name", { dappName: "" }],
    ["empty calls", { calls: [] }],
    ["zero amount", { amount: 0n }],
  ])("rejects %s", async (_label, override) => {
    const { client } = fixture();
    await expect(
      buildGateAActionSet(client, {
        token: 1n,
        amount: 1n,
        dappName: "strk",
        nonce: 0n,
        calls: [{ contractAddress: "0x1", entrypoint: "balance_of", calldata: [] }],
        ...override,
      })
    ).rejects.toThrow();
  });

  it("queues SetViewingKey ahead of every other action when registering", async () => {
    const { builder, client } = registrableFixture();

    const result = await buildGateAActionSet(client, { ...baseOptions, register: true });

    expect(result.registered).toBe(true);
    // ACCOUNT_PHASE 0: registration must precede the note and the withdrawal.
    expect(builder.actions).toEqual([
      { type: "setViewingKey" },
      { type: "transfer", token: "0x55", amount: "OPEN" },
      { type: "withdraw", token: "0x55", amount: "0x10", recipient: "0xabcde" },
    ]);
  });

  it("does not register unless asked", async () => {
    const { builder, client } = registrableFixture();

    const result = await buildGateAActionSet(client, baseOptions);

    expect(result.registered).toBe(false);
    expect(builder.actions).not.toContainEqual({ type: "setViewingKey" });
  });

  it("refuses to register on a builder that cannot express it", async () => {
    const { client } = fixture();

    await expect(
      buildGateAActionSet(client, { ...baseOptions, register: true })
    ).rejects.toThrow(/exposes no register\(\)/);
  });

  it("detects the registration capability and names the core options", () => {
    expect(supportsRegistration(new FakeBuilder())).toBe(false);
    expect(supportsRegistration(new FakeRegistrableBuilder())).toBe(true);
    expect(GATE_A_REGISTRATION_OPTIONS).toEqual({ autoRegister: true, autoSetup: true });
  });
});
