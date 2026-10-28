import axios, { type AxiosRequestConfig } from "axios";
import { message } from "antd";
import { AjaxUrl, RestNonce, RestUrl } from "@/utils/index";

// REST API 实例
export const restInstance = axios.create({
  baseURL: RestUrl,
});

if (RestNonce) {
  restInstance.defaults.headers.common["X-WP-Nonce"] = RestNonce;
}

export const ensureRestNonce = async (): Promise<string | null> => {
  const existingNonce = restInstance.defaults.headers.common[
    "X-WP-Nonce"
  ] as string | undefined;

  if (existingNonce) {
    return existingNonce;
  }

  if (RestNonce) {
    restInstance.defaults.headers.common["X-WP-Nonce"] = RestNonce;
    return RestNonce;
  }

  return null;
};

type RefreshRestNonceResponse = {
  success?: boolean;
  data?: {
    rest_nonce?: string;
  };
};

let restNonceRefreshPromise: Promise<string | null> | null = null;
let lastNonceFailureToastAt = 0;

const setRestNonce = (nonce: string) => {
  restInstance.defaults.headers.common["X-WP-Nonce"] = nonce;
};

const refreshRestNonce = async (): Promise<string | null> => {
  if (!AjaxUrl) {
    return null;
  }

  if (!restNonceRefreshPromise) {
    const form = new URLSearchParams();
    form.append("action", "npcink_device_inventory_refresh_rest_nonce");

    restNonceRefreshPromise = axios
      .post<RefreshRestNonceResponse>(AjaxUrl, form, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        withCredentials: true,
      })
      .then((response) => {
        const nonce = response.data?.data?.rest_nonce;
        if (response.data?.success && nonce) {
          setRestNonce(nonce);
          return nonce;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        restNonceRefreshPromise = null;
      });
  }

  return restNonceRefreshPromise;
};

const shouldShowNonceFailureToast = () => {
  const now = Date.now();
  if (now - lastNonceFailureToastAt < 3000) {
    return false;
  }
  lastNonceFailureToastAt = now;
  return true;
};

const responseInterceptor = (response: any) => {
  // 检查响应数据中是否有消息需要显示
  const payload = response.data;
  const nestedMessage = payload?.data?.message;
  const topMessage = payload?.message;
  if (nestedMessage || topMessage) {
    const showSuccessMessage =
      (response.config as RequestConfig)?.showSuccessMessage !== false;
    const messageText = nestedMessage || topMessage;
    if (payload?.success === false) {
      message.error(messageText);
    } else if (showSuccessMessage) {
      message.success(messageText);
    }
  }
  return response;
};

const friendlyErrorCodeMap: Record<string, string> = {
  duplicate_number: "设备编号已存在，请换一个编号再保存",
  forbidden: "权限不足，请联系管理员",
  missing_uuid: "缺少设备标识，请刷新页面后重试",
  not_found: "资源不存在或已被删除",
  invalid_data: "提交的数据格式不正确，请检查后重试",
  invalid_fields: "没有可更新的字段，请检查表单内容",
  missing_params: "缺少必要参数，请补全后重试",
  missing_id: "缺少记录ID，请刷新页面后重试",
  invalid_table: "表名不合法，请重新选择",
  invalid_route: "路由格式不合法，请重新填写",
  route_exists: "页面已存在，请换一个路由",
  json_encode_failed: "数据处理失败，请稍后重试",
  insert_failed: "保存失败，请稍后重试",
  update_failed: "保存失败，请稍后重试",
  delete_failed: "删除失败，请稍后重试",
  db_error: "数据库错误，请联系管理员",
  rest_forbidden: "权限不足或登录已过期，请刷新页面重试",
  rest_cookie_invalid_nonce: "登录已过期，请刷新页面重试",
  rest_cannot_edit: "没有权限修改该资源",
  rest_cannot_delete: "没有权限删除该资源",
};

const friendlyStatusMap: Record<number, string> = {
  400: "请求参数有误，请检查填写内容",
  401: "登录已过期，请刷新页面重试",
  403: "权限不足或登录已过期，请刷新页面重试",
  404: "资源不存在或已被删除",
  409: "数据冲突，请检查唯一字段（如编号）",
  413: "提交内容过大，请缩小后重试",
  429: "操作过于频繁，请稍后重试",
  500: "服务器开小差了，请稍后再试",
  503: "服务暂不可用，请稍后再试",
};

const friendlyErrorTextMap: Record<string, string> = {
  非法请求: "登录已过期，请刷新页面重试",
  权限不足: "权限不足，请联系管理员",
  设备编号已存在: "设备编号已存在，请换一个编号再保存",
};

const errorInterceptor = (error: any) => {
  if (axios.isCancel(error)) return Promise.reject(error);
  // 检查是否有返回错误信息，有的话展示，没有就显示默认错误信息
  let errorMessage: string;

  if (error.response) {
    // 服务器返回了错误状态码
    const status = error.response.status;
    const data = error.response.data;
    const code = data?.code;
    const rawText =
      data?.data?.error ||
      data?.data?.message ||
      data?.message ||
      data?.error;

    const isEnglishText =
      typeof rawText === "string" && /^[\x00-\x7F]+$/.test(rawText);

    if (code === "rest_cookie_invalid_nonce") {
      const config = error.config as RequestConfig | undefined;
      if (config && !config.nonceRetryAttempted) {
        config.nonceRetryAttempted = true;
        return refreshRestNonce().then((newNonce) => {
          if (!newNonce) {
            if (shouldShowNonceFailureToast()) {
              message.error(friendlyErrorCodeMap.rest_cookie_invalid_nonce);
            }
            return Promise.reject(error);
          }

          config.headers = config.headers || {};
          (config.headers as Record<string, string>)["X-WP-Nonce"] = newNonce;
          return restInstance.request(config);
        });
      }
      errorMessage = friendlyErrorCodeMap.rest_cookie_invalid_nonce;
    } else if (code && friendlyErrorCodeMap[code]) {
      errorMessage = friendlyErrorCodeMap[code];
    } else if (rawText && !isEnglishText) {
      // Prefer REST-provided localized messages.
      errorMessage = rawText;
    } else if (rawText && friendlyErrorTextMap[rawText]) {
      errorMessage = friendlyErrorTextMap[rawText];
    } else if (rawText) {
      errorMessage = rawText;
    } else if (status && friendlyStatusMap[status]) {
      errorMessage = friendlyStatusMap[status];
    } else if (data && data.data && data.data.message) {
      // 优先使用服务器返回的错误消息
      errorMessage = data.data.message;
    } else if (data && data.data && data.data.error) {
      // 其次使用服务器返回的错误信息
      errorMessage = data.data.error;
    } else if (data && data.message) {
      errorMessage = data.message;
    } else {
      // 默认使用状态文本
      errorMessage = `请求失败: ${status} ${error.response.statusText}`;
    }
  } else if (error.request) {
    // 请求已发出但没有收到响应
    errorMessage = "网络错误，请检查网络连接";
  } else {
    // 其他错误
    errorMessage = error.message || "未知错误";
  }

  if (
    error.response?.data?.code !== "rest_cookie_invalid_nonce" ||
    shouldShowNonceFailureToast()
  ) {
    message.error(errorMessage);
  }
  if (import.meta.env.DEV) {
    console.error("请求错误:", error);
  }
  return Promise.reject(error);
};

restInstance.interceptors.response.use(responseInterceptor, errorInterceptor);

/**
 * 检查它们的值是否为 undefined 并据此决定是否将它们添加到 URLSearchParams 实例中
 * 默认情况下，若不传值，则会输出 undefined字符串
 * @param params 实例
 * @param key 关键词
 * @param value 值
 */
export const addParamIfDefined = (
  params: URLSearchParams,
  key: string,
  value: any
) => {
  if (value !== undefined) {
    params.append(key, value);
  }
};

export type RequestConfig = AxiosRequestConfig & {
  showSuccessMessage?: boolean;
  nonceRetryAttempted?: boolean;
};
