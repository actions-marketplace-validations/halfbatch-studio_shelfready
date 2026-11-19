import type { Facts } from "./facts.js";

/**
 * App Store Connect "App Privacy" answers in fastlane's `app_privacy_details.json` format,
 * for `fastlane upload_app_privacy_details_to_app_store` (Apple ID login; no API key path exists).
 * Category, purpose and protection IDs follow fastlane's Spaceship constants.
 */
export interface AppPrivacyEntry {
  category?: string;
  purposes?: string[];
  data_protections: string[];
}

/** Privacy manifest data types → App Store Connect categories. Unmapped types are reported, never guessed. */
export const CATEGORY: Record<string, string> = {
  NSPrivacyCollectedDataTypeName: "NAME",
  NSPrivacyCollectedDataTypeEmailAddress: "EMAIL_ADDRESS",
  NSPrivacyCollectedDataTypePhoneNumber: "PHONE_NUMBER",
  NSPrivacyCollectedDataTypePhysicalAddress: "PHYSICAL_ADDRESS",
  NSPrivacyCollectedDataTypeOtherUserContactInfo: "OTHER_CONTACT_INFO",
  NSPrivacyCollectedDataTypeHealth: "HEALTH",
  NSPrivacyCollectedDataTypeFitness: "FITNESS",
  NSPrivacyCollectedDataTypePaymentInfo: "PAYMENT_INFORMATION",
  NSPrivacyCollectedDataTypeCreditInfo: "CREDIT_AND_FRAUD",
  NSPrivacyCollectedDataTypeOtherFinancialInfo: "OTHER_FINANCIAL_INFO",
  NSPrivacyCollectedDataTypePreciseLocation: "PRECISE_LOCATION",
  NSPrivacyCollectedDataTypeCoarseLocation: "COARSE_LOCATION",
  NSPrivacyCollectedDataTypeSensitiveInfo: "SENSITIVE_INFO",
  NSPrivacyCollectedDataTypeContacts: "CONTACTS",
  NSPrivacyCollectedDataTypeEmailsOrTextMessages: "EMAILS_OR_TEXT_MESSAGES",
  NSPrivacyCollectedDataTypePhotosorVideos: "PHOTOS_OR_VIDEOS",
  NSPrivacyCollectedDataTypeAudioData: "AUDIO",
  NSPrivacyCollectedDataTypeGameplayContent: "GAMEPLAY_CONTENT",
  NSPrivacyCollectedDataTypeCustomerSupport: "CUSTOMER_SUPPORT",
  NSPrivacyCollectedDataTypeOtherUserContent: "OTHER_USER_CONTENT",
  NSPrivacyCollectedDataTypeBrowsingHistory: "BROWSING_HISTORY",
  NSPrivacyCollectedDataTypeSearchHistory: "SEARCH_HISTORY",
  NSPrivacyCollectedDataTypeUserID: "USER_ID",
  NSPrivacyCollectedDataTypeDeviceID: "DEVICE_ID",
  NSPrivacyCollectedDataTypePurchaseHistory: "PURCHASE_HISTORY",
  NSPrivacyCollectedDataTypeProductInteraction: "PRODUCT_INTERACTION",
  NSPrivacyCollectedDataTypeAdvertisingData: "ADVERTISING_DATA",
  NSPrivacyCollectedDataTypeOtherUsageData: "OTHER_USAGE_DATA",
  NSPrivacyCollectedDataTypeCrashData: "CRASH_DATA",
  NSPrivacyCollectedDataTypePerformanceData: "PERFORMANCE_DATA",
  NSPrivacyCollectedDataTypeOtherDiagnosticData: "OTHER_DIAGNOSTIC_DATA",
  NSPrivacyCollectedDataTypeOtherDataTypes: "OTHER_DATA",
};

export const PURPOSE: Record<string, string> = {
  NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising: "THIRD_PARTY_ADVERTISING",
  NSPrivacyCollectedDataTypePurposeDeveloperAdvertising: "DEVELOPERS_ADVERTISING",
  NSPrivacyCollectedDataTypePurposeAnalytics: "ANALYTICS",
  NSPrivacyCollectedDataTypePurposeProductPersonalization: "PRODUCT_PERSONALIZATION",
  NSPrivacyCollectedDataTypePurposeAppFunctionality: "APP_FUNCTIONALITY",
  NSPrivacyCollectedDataTypePurposeOther: "OTHER_PURPOSES",
};

export interface AppPrivacyResult {
  entries: AppPrivacyEntry[];
  /** Data types or purposes with no App Store Connect equivalent; answer these by hand. */
  unmapped: string[];
}

export function appPrivacy(facts: Facts): AppPrivacyResult {
  if (facts.data.collected.length === 0) {
    return { entries: [{ data_protections: ["DATA_NOT_COLLECTED"] }], unmapped: [] };
  }
  const unmapped = new Set<string>();
  const byCategory = new Map<string, { purposes: Set<string>; protections: Set<string> }>();

  for (const item of facts.data.collected) {
    const category = CATEGORY[item.type];
    if (!category) {
      unmapped.add(item.type);
      continue;
    }
    const entry = byCategory.get(category) ?? { purposes: new Set(), protections: new Set() };
    for (const p of item.purposes) {
      const purpose = PURPOSE[p];
      if (purpose) entry.purposes.add(purpose);
      else unmapped.add(p);
    }
    entry.protections.add(item.linked ? "DATA_LINKED_TO_YOU" : "DATA_NOT_LINKED_TO_YOU");
    if (item.tracking) entry.protections.add("DATA_USED_TO_TRACK_YOU");
    byCategory.set(category, entry);
  }

  const entries = [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, e]) => ({ category, purposes: [...e.purposes].sort(), data_protections: [...e.protections].sort() }));
  return { entries, unmapped: [...unmapped].sort() };
}
