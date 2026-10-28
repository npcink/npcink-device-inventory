import type { CreatedClientToken } from "@/type/v3";
import { RestUrl } from "@/utils/index";

export const buildClientTokenValue = (token: CreatedClientToken) =>
  `mda_${token.id}_${token.secret}`;

export const buildClientImportConfig = (token: CreatedClientToken, uploadEndpoint: string) =>
  JSON.stringify(
    {
      uploadEndpoint,
      tokenValue: buildClientTokenValue(token),
      tokenName: token.name,
    },
    null,
    2
  );

export const buildClientUploadEndpoint = (input?: string) => {
  const base = (input || RestUrl).trim().replace(/\/+$/, "");
  if (!base) {
    return "/wp-json/npcink-device-inventory/v1/device-observations";
  }
  if (base.endsWith("/device-observations")) {
    return base;
  }
  if (base.endsWith("/npcink-device-inventory/v1")) {
    return `${base}/device-observations`;
  }
  if (base.endsWith("/wp-json")) {
    return `${base}/npcink-device-inventory/v1/device-observations`;
  }
  return `${base}/wp-json/npcink-device-inventory/v1/device-observations`;
};

export const buildClientSubmitCommand = (token: CreatedClientToken, uploadEndpoint: string) =>
  `npcink-device-agent submit --site "${uploadEndpoint}" --token "${buildClientTokenValue(token)}" --note "测试电脑"`;
