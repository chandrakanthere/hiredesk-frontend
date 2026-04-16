import axios from "axios";

let getAuthToken = async () => null;

const rawApiUrl = (import.meta.env?.VITE_API_URL || "").trim();
const normalizedApiUrl = rawApiUrl.replace(/\/$/, "");
const isLocalApiUrl =
    !normalizedApiUrl ||
    /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/api)?$/i.test(normalizedApiUrl);
const apiBaseUrl = isLocalApiUrl
    ? "/api"
    : normalizedApiUrl.endsWith("/api")
        ? normalizedApiUrl
        : `${normalizedApiUrl}/api`;

export const setAuthTokenGetter = (tokenGetter) => {
    getAuthToken = tokenGetter;
};

const axiosInstance = axios.create({
    baseURL: apiBaseUrl,
    withCredentials: true //by adding thid field browser will send cookies automatically with every single reqest            
});

axiosInstance.interceptors.request.use(async (config) => {
    const token = await getAuthToken();

    if (token) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
});

axiosInstance.interceptors.response.use(
    (response) => response,
    (error) => {
        const status = error?.response?.status;
        const url = error?.config?.baseURL
            ? `${error.config.baseURL}${error.config.url || ""}`
            : error?.config?.url;
        const data = error?.response?.data;
        const requestId =
            error?.response?.headers?.["x-request-id"] ||
            error?.response?.headers?.["X-Request-Id"] ||
            data?.requestId;

        // Useful during debugging: makes 500 root cause visible in browser console.
        console.error("API request failed:", {
            url,
            status,
            message: data?.message || error?.message,
            requestId,
            errorDetails: data?.errorDetails,
            data,
        });
        return Promise.reject(error);
    }
);

export default axiosInstance;
