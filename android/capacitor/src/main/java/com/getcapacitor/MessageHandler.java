package com.getcapacitor;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.apache.cordova.PluginManager;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * MessageHandler handles messages from the WebView, dispatching them
 * to plugins.
 */
public class MessageHandler {

    private Bridge bridge;
    private WebView webView;
    private PluginManager cordovaPluginManager;
    private JavaScriptReplyProxy javaScriptReplyProxy;
    
    // 同步调用相关
    private static final String SYNC_CALL_PREFIX = "sync_";
    private final ConcurrentHashMap<String, SyncCallResult> syncCallResults = new ConcurrentHashMap<>();
    private long syncCallCounter = 0;

    public MessageHandler(Bridge bridge, WebView webView, PluginManager cordovaPluginManager) {
        this.bridge = bridge;
        this.webView = webView;
        this.cordovaPluginManager = cordovaPluginManager;

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) && !bridge.getConfig().isUsingLegacyBridge()) {
            WebViewCompat.WebMessageListener capListener = (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                if (isMainFrame) {
                    postMessage(message.getData());
                    javaScriptReplyProxy = replyProxy;
                } else {
                    Logger.warn("Plugin execution is allowed in Main Frame only");
                }
            };
            try {
                WebViewCompat.addWebMessageListener(webView, "androidBridge", bridge.getAllowedOriginRules(), capListener);
                // 同时添加 JavascriptInterface 以支持同步调用 (callSync 等方法)
                webView.addJavascriptInterface(this, "androidBridge");
            } catch (Exception ex) {
                webView.addJavascriptInterface(this, "androidBridge");
            }
        } else {
            webView.addJavascriptInterface(this, "androidBridge");
        }
    }

    /**
     * The main message handler that will be called from JavaScript
     * to send a message to the native bridge.
     * @param jsonStr
     */
    @JavascriptInterface
    @SuppressWarnings("unused")
    public void postMessage(String jsonStr) {
        try {
            JSObject postData = new JSObject(jsonStr);

            String type = postData.getString("type");

            boolean typeIsNotNull = type != null;
            boolean isCordovaPlugin = typeIsNotNull && type.equals("cordova");
            boolean isJavaScriptError = typeIsNotNull && type.equals("js.error");

            String callbackId = postData.getString("callbackId");

            if (isCordovaPlugin) {
                String service = postData.getString("service");
                String action = postData.getString("action");
                String actionArgs = postData.getString("actionArgs");

                Logger.verbose(
                    Logger.tags("Plugin"),
                    "To native (Cordova plugin): callbackId: " +
                    callbackId +
                    ", service: " +
                    service +
                    ", action: " +
                    action +
                    ", actionArgs: " +
                    actionArgs
                );

                this.callCordovaPluginMethod(callbackId, service, action, actionArgs);
            } else if (isJavaScriptError) {
                Logger.error("JavaScript Error: " + jsonStr);
            } else {
                String pluginId = postData.getString("pluginId");
                String methodName = postData.getString("methodName");
                JSObject methodData = postData.getJSObject("options", new JSObject());

                Logger.verbose(
                    Logger.tags("Plugin"),
                    "To native (Capacitor plugin): callbackId: " + callbackId + ", pluginId: " + pluginId + ", methodName: " + methodName
                );

                this.callPluginMethod(callbackId, pluginId, methodName, methodData);
            }
        } catch (Exception ex) {
            Logger.error("Post message error:", ex);
        }
    }

    public void sendResponseMessage(PluginCall call, PluginResult successResult, PluginResult errorResult) {
        // 检查是否是同步调用
        if (isSyncCallback(call.getCallbackId())) {
            handleSyncResponse(call.getCallbackId(), successResult, errorResult);
            return;
        }
        
        try {
            PluginResult data = new PluginResult();
            data.put("save", call.isKeptAlive());
            data.put("callbackId", call.getCallbackId());
            data.put("pluginId", call.getPluginId());
            data.put("methodName", call.getMethodName());

            boolean pluginResultInError = errorResult != null;
            if (pluginResultInError) {
                data.put("success", false);
                data.put("error", errorResult);
                Logger.debug("Sending plugin error: " + data.toString());
            } else {
                data.put("success", true);
                if (successResult != null) {
                    data.put("data", successResult);
                }
            }

            boolean isValidCallbackId = !call.getCallbackId().equals(PluginCall.CALLBACK_ID_DANGLING);
            if (isValidCallbackId) {
                if (bridge.getConfig().isUsingLegacyBridge()) {
                    legacySendResponseMessage(data);
                } else if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) && javaScriptReplyProxy != null) {
                    javaScriptReplyProxy.postMessage(data.toString());
                } else {
                    legacySendResponseMessage(data);
                }
            } else {
                bridge.getApp().fireRestoredResult(data);
            }
        } catch (Exception ex) {
            Logger.error("sendResponseMessage: error: " + ex);
        }
        if (!call.isKeptAlive()) {
            call.release(bridge);
        }
    }

    private void legacySendResponseMessage(PluginResult data) {
        final String runScript = "window.Capacitor.fromNative(" + data.toString() + ")";
        final WebView webView = this.webView;
        webView.post(() -> webView.evaluateJavascript(runScript, null));
    }

    private void callPluginMethod(String callbackId, String pluginId, String methodName, JSObject methodData) {
        PluginCall call = new PluginCall(this, pluginId, callbackId, methodName, methodData);
        bridge.callPluginMethod(pluginId, methodName, call);
    }

    private void callCordovaPluginMethod(String callbackId, String service, String action, String actionArgs) {
        bridge.execute(() -> {
            cordovaPluginManager.exec(service, action, callbackId, actionArgs);
        });
    }
    
    // ==================== 同步调用支持 ====================
    
    /**
     * 同步调用原生插件方法
     * 这是关键：@JavascriptInterface 方法可以直接返回值给 JS
     * 
     * @param pluginId 插件 ID
     * @param methodName 方法名
     * @param optionsJson 参数 JSON 字符串
     * @return 结果 JSON 字符串
     */
    @JavascriptInterface
    @SuppressWarnings("unused")
    public String callSync(String pluginId, String methodName, String optionsJson) {
        Logger.verbose(Logger.tags("Plugin"), 
            "Sync call: " + pluginId + "." + methodName);
        
        try {
            // 解析参数
            JSObject options = new JSObject(optionsJson);
            
            // 生成唯一的同步调用 ID
            String syncCallId = SYNC_CALL_PREFIX + (++syncCallCounter);
            
            // 创建同步结果容器
            SyncCallResult syncResult = new SyncCallResult();
            syncCallResults.put(syncCallId, syncResult);
            
            try {
                // 创建 PluginCall，使用特殊的 callbackId
                PluginCall call = new PluginCall(this, pluginId, syncCallId, methodName, options);
                
                // 执行插件方法
                bridge.callPluginMethod(pluginId, methodName, call);
                
                // 等待结果（最多 30 秒超时）
                boolean completed = syncResult.latch.await(30, TimeUnit.SECONDS);
                
                if (!completed) {
                    return createErrorJson("Sync call timeout after 30 seconds");
                }
                
                // 返回结果
                if (syncResult.error != null) {
                    JSONObject result = new JSONObject();
                    result.put("success", false);
                    result.put("error", syncResult.error);
                    return result.toString();
                }
                
                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put("data", syncResult.data != null ? syncResult.data : new JSONObject());
                return result.toString();
                
            } finally {
                // 清理
                syncCallResults.remove(syncCallId);
            }
            
        } catch (Exception e) {
            Logger.error("Sync call error: ", e);
            return createErrorJson(e.getMessage());
        }
    }
    
    /**
     * 检查同步调用是否可用
     */
    @JavascriptInterface
    @SuppressWarnings("unused")
    public boolean isSyncAvailable() {
        return true;
    }
    
    /**
     * 获取同步桥接版本
     */
    @JavascriptInterface
    @SuppressWarnings("unused")
    public String getSyncVersion() {
        return "1.0.0";
    }
    
    /**
     * 检查是否是同步调用的回调
     */
    private boolean isSyncCallback(String callbackId) {
        return callbackId != null && callbackId.startsWith(SYNC_CALL_PREFIX);
    }
    
    /**
     * 处理同步调用的响应
     */
    private void handleSyncResponse(String callbackId, PluginResult successResult, PluginResult errorResult) {
        SyncCallResult syncResult = syncCallResults.get(callbackId);
        if (syncResult != null) {
            if (errorResult != null) {
                syncResult.error = errorResult;
            } else {
                syncResult.data = successResult;
            }
            syncResult.latch.countDown();
        }
    }
    
    private String createErrorJson(String message) {
        try {
            JSONObject error = new JSONObject();
            error.put("success", false);
            JSONObject errorObj = new JSONObject();
            errorObj.put("message", message != null ? message : "Unknown error");
            error.put("error", errorObj);
            return error.toString();
        } catch (JSONException e) {
            return "{\"success\":false,\"error\":{\"message\":\"Unknown error\"}}";
        }
    }
    
    /**
     * 同步调用结果容器
     */
    private static class SyncCallResult {
        final CountDownLatch latch = new CountDownLatch(1);
        volatile PluginResult data;
        volatile PluginResult error;
    }
}
