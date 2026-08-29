export {
  buildGateAActionSet,
  supportsRegistration,
  toHexFelt,
  GATE_A_REGISTRATION_OPTIONS,
  type BuildGateAActionSetOptions,
  type GateAActionSet,
  type GateAShadowAccount,
  type FeltLike,
  type PrivacyClientLike,
  type PrivacyBuilderLike,
  type PrivacyCall,
  type RegistrableBuilderLike,
  type CollectPolicy,
  type CollectPolicyInput,
} from "./gate-a.js";

export {
  assertRecipientUnlinked,
  buildErc20ApproveCall,
  buildEkuboQuoteCall,
  buildEkuboSwapPlan,
  buildEndurStakePlan,
  LinkedRecipientError,
  type AdapterPlan,
  type AdapterSettlement,
  type BuildEndurStakePlanOptions,
  type BuildEkuboSwapPlanOptions,
  type EkuboRouteOptions,
} from "./adapters.js";

export {
  deriveViewingKeyFromSignature,
  foldViewingKey,
  MAX_VIEWING_KEY,
  normalizeWalletSignature,
  VIEWING_KEY_LABEL,
} from "./wallet-identity.js";
