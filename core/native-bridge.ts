/**
 * Note: When making changes to this file, run `npm run build:nativebridge`
 * afterwards to build the nativebridge.js files to the android and iOS projects.
 */
import type { HttpResponse } from './src/core-plugins';
import type {
  CallData,
  CapacitorInstance,
  ErrorCallData,
  MessageCallData,
  PluginResult,
  WindowCapacitor,
  CapFormDataEntry,
} from './src/definitions-internal';
import { CapacitorException } from './src/util';

// For removing exports for iOS/Android, keep let for reassignment
// eslint-disable-next-line
let dummy = {};

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const data = reader.result as string;
      resolve(btoa(data));
    };
    reader.onerror = reject;

    reader.readAsBinaryString(file);
  });

const convertFormData = async (formData: FormData): Promise<any> => {
  const newFormData: CapFormDataEntry[] = [];
  for (const pair of formData.entries()) {
    const [key, value] = pair;
    if (value instanceof File) {
      const base64File = await readFileAsBase64(value);
      newFormData.push({
        key,
        value: base64File,
        type: 'base64File',
        contentType: value.type,
        fileName: value.name,
      });
    } else {
      newFormData.push({ key, value, type: 'string' });
    }
  }

  return newFormData;
};

const convertBody = async (
  body: Document | XMLHttpRequestBodyInit | ReadableStream<any> | undefined,
  contentType?: string,
): Promise<any> => {
  if (body instanceof ReadableStream || body instanceof Uint8Array) {
    let encodedData;
    if (body instanceof ReadableStream) {
      const reader = body.getReader();
      const chunks: any[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const concatenated = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
      let position = 0;
      for (const chunk of chunks) {
        concatenated.set(chunk, position);
        position += chunk.length;
      }
      encodedData = concatenated;
    } else {
      encodedData = body;
    }

    let data = new TextDecoder().decode(encodedData);
    let type;
    if (contentType === 'application/json') {
      try {
        data = JSON.parse(data);
      } catch (ignored) {
        // ignore
      }
      type = 'json';
    } else if (contentType === 'multipart/form-data') {
      type = 'formData';
    } else if (contentType?.startsWith('image')) {
      type = 'image';
    } else if (contentType === 'application/octet-stream') {
      type = 'binary';
    } else {
      type = 'text';
    }

    return {
      data,
      type,
      headers: { 'Content-Type': contentType || 'application/octet-stream' },
    };
  } else if (body instanceof URLSearchParams) {
    return {
      data: body.toString(),
      type: 'text',
    };
  } else if (body instanceof FormData) {
    return {
      data: await convertFormData(body),
      type: 'formData',
    };
  } else if (body instanceof File) {
    const fileData = await readFileAsBase64(body);
    return {
      data: fileData,
      type: 'file',
      headers: { 'Content-Type': body.type },
    };
  }

  return { data: body, type: 'json' };
};

const CAPACITOR_HTTP_INTERCEPTOR = '/_capacitor_http_interceptor_';
const CAPACITOR_HTTP_INTERCEPTOR_URL_PARAM = 'u';

// TODO: export as Cap function
const isRelativeOrProxyUrl = (url: string | undefined): boolean =>
  !url || !(url.startsWith('http:') || url.startsWith('https:')) || url.indexOf(CAPACITOR_HTTP_INTERCEPTOR) > -1;

// TODO: export as Cap function
const createProxyUrl = (url: string, win: WindowCapacitor): string => {
  if (isRelativeOrProxyUrl(url)) return url;
  const bridgeUrl = new URL(win.Capacitor?.getServerUrl() ?? '');
  bridgeUrl.pathname = CAPACITOR_HTTP_INTERCEPTOR;
  bridgeUrl.searchParams.append(CAPACITOR_HTTP_INTERCEPTOR_URL_PARAM, url);

  return bridgeUrl.toString();
};

const initBridge = (w: any): void => {
  const getPlatformId = (win: WindowCapacitor): 'android' | 'ios' | 'web' => {
    if (win?.androidBridge) {
      return 'android';
    } else if (win?.webkit?.messageHandlers?.bridge) {
      return 'ios';
    } else {
      return 'web';
    }
  };

  const convertFileSrcServerUrl = (webviewServerUrl: string, filePath: string): string => {
    if (typeof filePath === 'string') {
      if (filePath.startsWith('/')) {
        return webviewServerUrl + '/_capacitor_file_' + filePath;
      } else if (filePath.startsWith('file://')) {
        return webviewServerUrl + filePath.replace('file://', '/_capacitor_file_');
      } else if (filePath.startsWith('content://')) {
        return webviewServerUrl + filePath.replace('content:/', '/_capacitor_content_');
      }
    }
    return filePath;
  };

  const initEvents = (win: WindowCapacitor, cap: CapacitorInstance) => {
    cap.addListener = (pluginName, eventName, callback) => {
      const callbackId = cap.nativeCallback(
        pluginName,
        'addListener',
        {
          eventName: eventName,
        },
        callback,
      );
      return {
        remove: async () => {
          win?.console?.debug('Removing listener', pluginName, eventName);
          cap.removeListener?.(pluginName, callbackId, eventName, callback);
        },
      };
    };

    cap.removeListener = (pluginName, callbackId, eventName, callback) => {
      cap.nativeCallback(
        pluginName,
        'removeListener',
        {
          callbackId: callbackId,
          eventName: eventName,
        },
        callback,
      );
    };

    cap.createEvent = (eventName, eventData) => {
      const doc = win.document;
      if (doc) {
        const ev = doc.createEvent('Events');
        ev.initEvent(eventName, false, false);
        if (eventData && typeof eventData === 'object') {
          for (const i in eventData) {
            // eslint-disable-next-line no-prototype-builtins
            if (eventData.hasOwnProperty(i)) {
              ev[i] = eventData[i];
            }
          }
        }
        return ev;
      }
      return null;
    };

    cap.triggerEvent = (eventName, target, eventData) => {
      const doc = win.document;
      const cordova = win.cordova;
      eventData = eventData || {};
      const ev = cap.createEvent?.(eventName, eventData);

      if (ev) {
        if (target === 'document') {
          if (cordova?.fireDocumentEvent) {
            cordova.fireDocumentEvent(eventName, eventData);
            return true;
          } else if (doc?.dispatchEvent) {
            return doc.dispatchEvent(ev);
          }
        } else if (target === 'window' && win.dispatchEvent) {
          return win.dispatchEvent(ev);
        } else if (doc?.querySelector) {
          const targetEl = doc.querySelector(target);
          if (targetEl) {
            return targetEl.dispatchEvent(ev);
          }
        }
      }
      return false;
    };

    win.Capacitor = cap;
  };

  const initLegacyHandlers = (win: WindowCapacitor, cap: CapacitorInstance) => {
    // define cordova if it's not there already
    win.cordova = win.cordova || {};

    const doc = win.document;
    const nav = win.navigator;

    if (nav) {
      nav.app = nav.app || {};
      nav.app.exitApp = () => {
        if (!cap.Plugins?.App) {
          win.console?.warn('App plugin not installed');
        } else {
          cap.nativeCallback('App', 'exitApp', {});
        }
      };
    }

    if (doc) {
      const docAddEventListener = doc.addEventListener;
      doc.addEventListener = (...args: any[]) => {
        const eventName = args[0];
        const handler = args[1];
        if (eventName === 'deviceready' && handler) {
          Promise.resolve().then(handler);
        } else if (eventName === 'backbutton' && cap.Plugins.App) {
          // Add a dummy listener so Capacitor doesn't do the default
          // back button action
          if (!cap.Plugins?.App) {
            win.console?.warn('App plugin not installed');
          } else {
            cap.Plugins.App.addListener('backButton', () => {
              // ignore
            });
          }
        }
        return docAddEventListener.apply(doc, args);
      };
    }

    win.Capacitor = cap;
  };

  const initVendor = (win: WindowCapacitor, cap: CapacitorInstance) => {
    const Ionic = (win.Ionic = win.Ionic || {});
    const IonicWebView = (Ionic.WebView = Ionic.WebView || {});
    const Plugins = cap.Plugins;

    IonicWebView.getServerBasePath = (callback: (path: string) => void) => {
      Plugins?.WebView?.getServerBasePath().then((result: any) => {
        callback(result.path);
      });
    };

    IonicWebView.setServerAssetPath = (path: any) => {
      Plugins?.WebView?.setServerAssetPath({ path });
    };

    IonicWebView.setServerBasePath = (path: any) => {
      Plugins?.WebView?.setServerBasePath({ path });
    };

    IonicWebView.persistServerBasePath = () => {
      Plugins?.WebView?.persistServerBasePath();
    };

    IonicWebView.convertFileSrc = (url: string) => cap.convertFileSrc(url);

    win.Capacitor = cap;
    win.Ionic.WebView = IonicWebView;
  };

  const initLogger = (win: WindowCapacitor, cap: CapacitorInstance) => {
    const BRIDGED_CONSOLE_METHODS: (keyof Console)[] = ['debug', 'error', 'info', 'log', 'trace', 'warn'];

    const createLogFromNative = (c: Partial<Console>) => (result: PluginResult) => {
      if (isFullConsole(c)) {
        const success = result.success === true;

        const tagStyles = success
          ? 'font-style: italic; font-weight: lighter; color: gray'
          : 'font-style: italic; font-weight: lighter; color: red';
        c.groupCollapsed(
          '%cresult %c' + result.pluginId + '.' + result.methodName + ' (#' + result.callbackId + ')',
          tagStyles,
          'font-style: italic; font-weight: bold; color: #444',
        );
        if (result.success === false) {
          c.error(result.error);
        } else {
          c.dir(JSON.stringify(result.data));
        }
        c.groupEnd();
      } else {
        if (result.success === false) {
          c.error?.('LOG FROM NATIVE', result.error);
        } else {
          c.log?.('LOG FROM NATIVE', result.data);
        }
      }
    };

    const createLogToNative = (c: Partial<Console>) => (call: MessageCallData) => {
      if (isFullConsole(c)) {
        c.groupCollapsed(
          '%cnative %c' + call.pluginId + '.' + call.methodName + ' (#' + call.callbackId + ')',
          'font-weight: lighter; color: gray',
          'font-weight: bold; color: #000',
        );
        c.dir(call);
        c.groupEnd();
      } else {
        c.log?.('LOG TO NATIVE: ', call);
      }
    };

    const isFullConsole = (c: Partial<Console>): c is Console => {
      if (!c) {
        return false;
      }

      return typeof c.groupCollapsed === 'function' || typeof c.groupEnd === 'function' || typeof c.dir === 'function';
    };

    const serializeConsoleMessage = (msg: any): string => {
      try {
        if (typeof msg === 'object') {
          msg = JSON.stringify(msg);
        }
        return String(msg);
      } catch (e) {
        return '';
      }
    };

    const platform = getPlatformId(win);

    if (platform == 'android' || platform == 'ios') {
      // patch document.cookie on Android/iOS
      win.CapacitorCookiesDescriptor =
        Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
        Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');

      let doPatchCookies = false;

      // check if capacitor cookies is disabled before patching
      if (platform === 'ios') {
        // Use prompt to synchronously get capacitor cookies config.
        // https://stackoverflow.com/questions/29249132/wkwebview-complex-communication-between-javascript-native-code/49474323#49474323

        const payload = {
          type: 'CapacitorCookies.isEnabled',
        };

        const isCookiesEnabled = prompt(JSON.stringify(payload));
        if (isCookiesEnabled === 'true') {
          doPatchCookies = true;
        }
      } else if (typeof win.CapacitorCookiesAndroidInterface !== 'undefined') {
        const isCookiesEnabled = win.CapacitorCookiesAndroidInterface.isEnabled();
        if (isCookiesEnabled === true) {
          doPatchCookies = true;
        }
      }

      if (doPatchCookies) {
        Object.defineProperty(document, 'cookie', {
          get: function () {
            if (platform === 'ios') {
              // Use prompt to synchronously get cookies.
              // https://stackoverflow.com/questions/29249132/wkwebview-complex-communication-between-javascript-native-code/49474323#49474323

              const payload = {
                type: 'CapacitorCookies.get',
              };

              const res = prompt(JSON.stringify(payload));
              return res;
            } else if (typeof win.CapacitorCookiesAndroidInterface !== 'undefined') {
              // return original document.cookie since Android does not support filtering of `httpOnly` cookies
              return win.CapacitorCookiesDescriptor?.get?.call(document) ?? '';
            }
          },
          set: function (val) {
            const cookiePairs = val.split(';');
            const domainSection = val.toLowerCase().split('domain=')[1];
            const domain =
              cookiePairs.length > 1 && domainSection != null && domainSection.length > 0
                ? domainSection.split(';')[0].trim()
                : '';

            if (platform === 'ios') {
              // Use prompt to synchronously set cookies.
              // https://stackoverflow.com/questions/29249132/wkwebview-complex-communication-between-javascript-native-code/49474323#49474323

              const payload = {
                type: 'CapacitorCookies.set',
                action: val,
                domain,
              };

              prompt(JSON.stringify(payload));
            } else if (typeof win.CapacitorCookiesAndroidInterface !== 'undefined') {
              win.CapacitorCookiesAndroidInterface.setCookie(domain, val);
            }
          },
        });
      }

      // patch fetch / XHR on Android/iOS
      // store original fetch & XHR functions
      win.CapacitorWebFetch = window.fetch;
      win.CapacitorWebXMLHttpRequest = {
        abort: window.XMLHttpRequest.prototype.abort,
        constructor: window.XMLHttpRequest.prototype.constructor,
        fullObject: window.XMLHttpRequest,
        getAllResponseHeaders: window.XMLHttpRequest.prototype.getAllResponseHeaders,
        getResponseHeader: window.XMLHttpRequest.prototype.getResponseHeader,
        open: window.XMLHttpRequest.prototype.open,
        prototype: window.XMLHttpRequest.prototype,
        send: window.XMLHttpRequest.prototype.send,
        setRequestHeader: window.XMLHttpRequest.prototype.setRequestHeader,
      };

      let doPatchHttp = false;

      // check if capacitor http is disabled before patching
      if (platform === 'ios') {
        // Use prompt to synchronously get capacitor http config.
        // https://stackoverflow.com/questions/29249132/wkwebview-complex-communication-between-javascript-native-code/49474323#49474323

        const payload = {
          type: 'CapacitorHttp',
        };

        const isHttpEnabled = prompt(JSON.stringify(payload));
        if (isHttpEnabled === 'true') {
          doPatchHttp = true;
        }
      } else if (typeof win.CapacitorHttpAndroidInterface !== 'undefined') {
        const isHttpEnabled = win.CapacitorHttpAndroidInterface.isEnabled();
        if (isHttpEnabled === true) {
          doPatchHttp = true;
        }
      }

      if (doPatchHttp) {
        // fetch patch
        window.fetch = async (resource: RequestInfo | URL, options?: RequestInit) => {
          const headers = new Headers(options?.headers);
          const contentType = headers.get('Content-Type') || headers.get('content-type');
          if (
            options?.body instanceof FormData &&
            contentType?.includes('multipart/form-data') &&
            !contentType.includes('boundary')
          ) {
            headers.delete('Content-Type');
            headers.delete('content-type');
            options.headers = headers;
          }
          const request = new Request(resource, options);
          if (request.url.startsWith(`${cap.getServerUrl()}/`)) {
            return win.CapacitorWebFetch(resource, options);
          }
          const { method } = request;
          if (
            method.toLocaleUpperCase() === 'GET' ||
            method.toLocaleUpperCase() === 'HEAD' ||
            method.toLocaleUpperCase() === 'OPTIONS' ||
            method.toLocaleUpperCase() === 'TRACE'
          ) {
            // a workaround for following android webview issue:
            // https://issues.chromium.org/issues/40450316
            // Sets the user-agent header to a custom value so that its not stripped
            // on its way to the native layer
            if (platform === 'android' && options?.headers) {
              const userAgent = headers.get('User-Agent') || headers.get('user-agent');
              if (userAgent !== null) {
                headers.set('x-cap-user-agent', userAgent);
                options.headers = headers;
              }
            }

            if (typeof resource === 'string') {
              return await win.CapacitorWebFetch(createProxyUrl(resource, win), options);
            } else if (resource instanceof Request) {
              const modifiedRequest = new Request(createProxyUrl(resource.url, win), resource);
              return await win.CapacitorWebFetch(modifiedRequest, options);
            }
          }

          const tag = `CapacitorHttp fetch ${Date.now()} ${resource}`;
          console.time(tag);

          try {
            const { body } = request;
            const optionHeaders = Object.fromEntries(request.headers.entries());
            const {
              data: requestData,
              type,
              headers: requestHeaders,
            } = await convertBody(
              options?.body || body || undefined,
              optionHeaders['Content-Type'] || optionHeaders['content-type'],
            );

            const nativeHeaders = {
              ...requestHeaders,
              ...optionHeaders,
            };

            if (platform === 'android') {
              if (headers.has('User-Agent')) {
                nativeHeaders['User-Agent'] = headers.get('User-Agent');
              }

              if (headers.has('user-agent')) {
                nativeHeaders['user-agent'] = headers.get('user-agent');
              }
            }

            const nativeResponse: HttpResponse = await cap.nativePromise('CapacitorHttp', 'request', {
              url: request.url,
              method: method,
              data: requestData,
              dataType: type,
              headers: nativeHeaders,
            });

            const contentType = nativeResponse.headers['Content-Type'] || nativeResponse.headers['content-type'];
            let data = contentType?.startsWith('application/json')
              ? JSON.stringify(nativeResponse.data)
              : nativeResponse.data;

            // use null data for 204 No Content HTTP response
            if (nativeResponse.status === 204) {
              data = null;
            }

            // intercept & parse response before returning
            const response = new Response(data, {
              headers: nativeResponse.headers,
              status: nativeResponse.status,
            });

            /*
             * copy url to response, `cordova-plugin-ionic` uses this url from the response
             * we need `Object.defineProperty` because url is an inherited getter on the Response
             * see: https://stackoverflow.com/a/57382543
             * */
            Object.defineProperty(response, 'url', {
              value: nativeResponse.url,
            });

            console.timeEnd(tag);
            return response;
          } catch (error) {
            console.timeEnd(tag);
            return Promise.reject(error);
          }
        };

        // XHR patch
        interface PatchedXMLHttpRequestConstructor extends XMLHttpRequest {
          new (): XMLHttpRequest;
        }

        window.XMLHttpRequest = function () {
          const xhr = new win.CapacitorWebXMLHttpRequest.constructor();
          Object.defineProperties(xhr, {
            _headers: {
              value: {},
              writable: true,
            },
            _method: {
              value: xhr.method,
              writable: true,
            },
          });
          const prototype = win.CapacitorWebXMLHttpRequest.prototype;

          const isProgressEventAvailable = () =>
            typeof ProgressEvent !== 'undefined' && ProgressEvent.prototype instanceof Event;

          // XHR patch abort
          prototype.abort = function () {
            if (isRelativeOrProxyUrl(this._url)) {
              return win.CapacitorWebXMLHttpRequest.abort.call(this);
            }
            this.readyState = 0;
            setTimeout(() => {
              this.dispatchEvent(new Event('abort'));
              this.dispatchEvent(new Event('loadend'));
            });
          };

          // XHR patch open
          prototype.open = function (method: string, url: string) {
            this._method = method.toLocaleUpperCase();
            this._url = url;

            if (
              !this._method ||
              this._method === 'GET' ||
              this._method === 'HEAD' ||
              this._method === 'OPTIONS' ||
              this._method === 'TRACE'
            ) {
              if (isRelativeOrProxyUrl(url)) {
                return win.CapacitorWebXMLHttpRequest.open.call(this, method, url);
              }

              this._url = createProxyUrl(this._url, win);

              return win.CapacitorWebXMLHttpRequest.open.call(this, method, this._url);
            }
            Object.defineProperties(this, {
              readyState: {
                get: function () {
                  return this._readyState ?? 0;
                },
                set: function (val: number) {
                  this._readyState = val;
                  setTimeout(() => {
                    this.dispatchEvent(new Event('readystatechange'));
                  });
                },
              },
            });
            setTimeout(() => {
              this.dispatchEvent(new Event('loadstart'));
            });
            this.readyState = 1;
          };

          // XHR patch set request header
          prototype.setRequestHeader = function (header: string, value: string) {
            // a workaround for the following android web view issue:
            // https://issues.chromium.org/issues/40450316
            // Sets the user-agent header to a custom value so that its not stripped
            // on its way to the native layer
            if (platform === 'android' && (header === 'User-Agent' || header === 'user-agent')) {
              header = 'x-cap-user-agent';
            }

            if (isRelativeOrProxyUrl(this._url)) {
              return win.CapacitorWebXMLHttpRequest.setRequestHeader.call(this, header, value);
            }
            this._headers[header] = value;
          };

          // XHR patch send
          prototype.send = function (body?: Document | XMLHttpRequestBodyInit) {
            if (isRelativeOrProxyUrl(this._url)) {
              return win.CapacitorWebXMLHttpRequest.send.call(this, body);
            }

            const tag = `CapacitorHttp XMLHttpRequest ${Date.now()} ${this._url}`;
            console.time(tag);

            try {
              this.readyState = 2;

              Object.defineProperties(this, {
                response: {
                  value: '',
                  writable: true,
                },
                responseText: {
                  value: '',
                  writable: true,
                },
                responseURL: {
                  value: '',
                  writable: true,
                },
                status: {
                  value: 0,
                  writable: true,
                },
              });

              convertBody(body).then(({ data, type, headers }) => {
                let otherHeaders =
                  this._headers != null && Object.keys(this._headers).length > 0 ? this._headers : undefined;

                if (body instanceof FormData) {
                  if (!this._headers['Content-Type'] && !this._headers['content-type']) {
                    otherHeaders = {
                      ...otherHeaders,
                      'Content-Type': `multipart/form-data; boundary=----WebKitFormBoundary${Math.random().toString(36).substring(2, 15)}`,
                    };
                  }
                }

                // intercept request & pass to the bridge
                cap
                  .nativePromise('CapacitorHttp', 'request', {
                    url: this._url,
                    method: this._method,
                    data: data !== null ? data : undefined,
                    headers: {
                      ...headers,
                      ...otherHeaders,
                    },
                    dataType: type,
                  })
                  .then((nativeResponse: any) => {
                    // intercept & parse response before returning
                    if (this.readyState == 2) {
                      //TODO: Add progress event emission on native side
                      if (isProgressEventAvailable()) {
                        this.dispatchEvent(
                          new ProgressEvent('progress', {
                            lengthComputable: true,
                            loaded: nativeResponse.data.length,
                            total: nativeResponse.data.length,
                          }),
                        );
                      }
                      this._headers = nativeResponse.headers;
                      this.status = nativeResponse.status;
                      if (this.responseType === '' || this.responseType === 'text') {
                        this.response =
                          typeof nativeResponse.data !== 'string'
                            ? JSON.stringify(nativeResponse.data)
                            : nativeResponse.data;
                      } else {
                        this.response = nativeResponse.data;
                      }
                      this.responseText = (
                        nativeResponse.headers['Content-Type'] || nativeResponse.headers['content-type']
                      )?.startsWith('application/json')
                        ? JSON.stringify(nativeResponse.data)
                        : nativeResponse.data;
                      this.responseURL = nativeResponse.url;
                      this.readyState = 4;
                      setTimeout(() => {
                        this.dispatchEvent(new Event('load'));
                        this.dispatchEvent(new Event('loadend'));
                      });
                    }
                    console.timeEnd(tag);
                  })
                  .catch((error: any) => {
                    this.status = error.status;
                    this._headers = error.headers;
                    this.response = error.data;
                    this.responseText = JSON.stringify(error.data);
                    this.responseURL = error.url;
                    this.readyState = 4;
                    if (isProgressEventAvailable()) {
                      this.dispatchEvent(
                        new ProgressEvent('progress', {
                          lengthComputable: false,
                          loaded: 0,
                          total: 0,
                        }),
                      );
                    }
                    setTimeout(() => {
                      this.dispatchEvent(new Event('error'));
                      this.dispatchEvent(new Event('loadend'));
                    });
                    console.timeEnd(tag);
                  });
              });
            } catch (error: unknown) {
              this.status = 500;
              this._headers = {};
              this.response = error;
              this.responseText = String(error);
              this.responseURL = this._url;
              this.readyState = 4;
              if (isProgressEventAvailable()) {
                this.dispatchEvent(
                  new ProgressEvent('progress', {
                    lengthComputable: false,
                    loaded: 0,
                    total: 0,
                  }),
                );
              }
              setTimeout(() => {
                this.dispatchEvent(new Event('error'));
                this.dispatchEvent(new Event('loadend'));
              });
              console.timeEnd(tag);
            }
          };

          // XHR patch getAllResponseHeaders
          prototype.getAllResponseHeaders = function () {
            if (isRelativeOrProxyUrl(this._url)) {
              return win.CapacitorWebXMLHttpRequest.getAllResponseHeaders.call(this);
            }

            let returnString = '';
            for (const key in this._headers) {
              if (key != 'Set-Cookie') {
                returnString += key + ': ' + this._headers[key] + '\r\n';
              }
            }
            return returnString;
          };

          // XHR patch getResponseHeader
          prototype.getResponseHeader = function (name: string) {
            if (isRelativeOrProxyUrl(this._url)) {
              return win.CapacitorWebXMLHttpRequest.getResponseHeader.call(this, name);
            }
            return this._headers[name];
          };

          Object.setPrototypeOf(xhr, prototype);
          return xhr;
        } as unknown as PatchedXMLHttpRequestConstructor;

        Object.assign(window.XMLHttpRequest, win.CapacitorWebXMLHttpRequest.fullObject);
      }
    }

    // patch window.console on iOS and store original console fns
    const isIos = getPlatformId(win) === 'ios';
    if (win.console && isIos) {
      Object.defineProperties(
        win.console,
        BRIDGED_CONSOLE_METHODS.reduce((props: any, method) => {
          const consoleMethod = (win.console as any)[method].bind(win.console);
          props[method] = {
            value: (...args: any[]) => {
              const msgs = [...args];
              cap.toNative?.('Console', 'log', {
                level: method,
                message: msgs.map(serializeConsoleMessage).join(' '),
              });
              return consoleMethod(...args);
            },
          };
          return props;
        }, {}),
      );
    }

    cap.logJs = (msg, level) => {
      switch (level) {
        case 'error':
          win.console?.error(msg);
          break;
        case 'warn':
          win.console?.warn(msg);
          break;
        case 'info':
          win.console?.info(msg);
          break;
        default:
          win.console?.log(msg);
      }
    };

    cap.logToNative = createLogToNative(win.console || {});
    cap.logFromNative = createLogFromNative(win.console || {});

    cap.handleError = (err) => win.console?.error(err);

    win.Capacitor = cap;
  };

  function initNativeBridge(win: WindowCapacitor) {
    const cap = win.Capacitor || ({} as CapacitorInstance);

    // keep a collection of callbacks for native response data
    const callbacks = new Map();

    const webviewServerUrl = typeof win.WEBVIEW_SERVER_URL === 'string' ? win.WEBVIEW_SERVER_URL : '';
    cap.getServerUrl = () => webviewServerUrl;
    cap.convertFileSrc = (filePath) => convertFileSrcServerUrl(webviewServerUrl, filePath);

    // Counter of callback ids, randomized to avoid
    // any issues during reloads if a call comes back with
    // an existing callback id from an old session
    let callbackIdCount = Math.floor(Math.random() * 134217728);

    let postToNative: ((data: CallData) => void) | null = null;

    const isNativePlatform = () => true;
    const getPlatform = () => getPlatformId(win);

    // ==================== 同步调用支持 ====================
    
    /**
     * 同步调用配置
     */
    interface SyncConfig {
      enabled: boolean;
      // 适合同步调用的插件（轻量级、快速返回）
      syncPlugins: string[];
      // 适合同步调用的方法
      syncMethods: Record<string, string[]>;
      // 超时时间（毫秒）
      timeout: number;
    }
    
    const defaultSyncConfig: SyncConfig = {
      enabled: true,
      syncPlugins: [
        'Storage',      // 本地存储操作
        'Preferences',  // 偏好设置
        'Device',       // 设备信息
        'App',          // 应用信息
      ],
      syncMethods: {
        'Storage': ['get', 'keys', 'getItem'],
        'Preferences': ['get', 'keys'],
        'Device': ['getInfo', 'getId', 'getBatteryInfo'],
        'App': ['getInfo', 'getState'],
      },
      timeout: 5000,
    };
    
    // 从 capacitor.config.json 读取配置
    let syncConfig: SyncConfig = defaultSyncConfig;
    
    const loadSyncConfig = () => {
      // 使用 console.log 确保日志能输出
      const log = (msg: string, ...args: any[]) => {
        try {
          win?.console?.log?.('⚡ [SyncBridge] ' + msg, ...args);
        } catch (e) {}
      };
      
      log('开始加载配置...', 'androidBridge.callSync:', typeof (win as any).androidBridge?.callSync);
      
      // 优先从 window.__CAPACITOR_SYNC_CONFIG__ 读取（用于测试/覆盖）
      if ((win as any).__CAPACITOR_SYNC_CONFIG__) {
        syncConfig = (win as any).__CAPACITOR_SYNC_CONFIG__;
        log('配置已加载 (from __CAPACITOR_SYNC_CONFIG__)');
        return;
      }
      
      // 尝试从 Capacitor 注入的配置读取
      const capConfig = (win as any).Capacitor?.config?.plugins?.SyncBridge;
      if (capConfig) {
        syncConfig = {
          enabled: capConfig.enabled !== false,
          syncPlugins: capConfig.enabledPlugins || defaultSyncConfig.syncPlugins,
          syncMethods: capConfig.enabledMethods || defaultSyncConfig.syncMethods,
          timeout: capConfig.timeout || defaultSyncConfig.timeout,
        };
        log('配置已加载 (from Capacitor.config)', 'syncPlugins:', syncConfig.syncPlugins);
        return;
      }
      
      // 从 capacitor.config.json 文件读取
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'capacitor.config.json', false); // 同步请求，相对路径
        xhr.send();
        log('XHR status:', xhr.status);
        if (xhr.status === 200) {
          const config = JSON.parse(xhr.responseText);
          const pluginConfig = config?.plugins?.SyncBridge;
          if (pluginConfig) {
            syncConfig = {
              enabled: pluginConfig.enabled !== false,
              syncPlugins: pluginConfig.enabledPlugins || defaultSyncConfig.syncPlugins,
              syncMethods: pluginConfig.enabledMethods || defaultSyncConfig.syncMethods,
              timeout: pluginConfig.timeout || defaultSyncConfig.timeout,
            };
            log('配置已加载! 启用插件:', syncConfig.syncPlugins);
            return;
          }
        }
      } catch (e: any) {
        log('XHR 加载失败:', e?.message || e);
      }
      
      log('使用默认配置');
    };
    
    // 立即尝试加载配置
    loadSyncConfig();
    
    // ==================== 结果缓存支持 ====================
    
    /**
     * 缓存配置接口
     */
    interface CacheConfig {
      enabled: boolean;
      // 启用缓存的插件方法及其 TTL（毫秒）
      methods: Record<string, Record<string, number>>;
      // 默认 TTL（毫秒）
      defaultTTL: number;
      // 最大缓存条目数
      maxEntries: number;
    }
    
    interface CacheEntry {
      data: any;
      expires: number;
      optionsHash: string;
    }
    
    const defaultCacheConfig: CacheConfig = {
      enabled: true,
      methods: {
        // 设备信息 - 几乎不变，缓存 5 分钟
        'Device': {
          'getInfo': 300000,
          'getId': 300000,
          'getBatteryInfo': 30000,  // 电池信息 30 秒
          'getLanguageCode': 300000,
          'getLanguageTag': 300000,
        },
        // 应用信息 - 不变，缓存 5 分钟
        'App': {
          'getInfo': 300000,
          'getState': 5000,  // 应用状态 5 秒
          'getLaunchUrl': 300000,
        },
        // 偏好设置 - 缓存 10 秒（可能被修改）
        'Preferences': {
          'get': 10000,
          'keys': 10000,
        },
        // 状态栏 - 缓存 5 秒
        'StatusBar': {
          'getInfo': 5000,
        },
        // 网络状态 - 缓存 5 秒
        'Network': {
          'getStatus': 5000,
        },
        // 屏幕信息 - 缓存 30 秒
        'Screen': {
          'getInfo': 30000,
        },
      },
      defaultTTL: 10000,
      maxEntries: 100,
    };
    
    let cacheConfig: CacheConfig = defaultCacheConfig;
    const resultCache = new Map<string, CacheEntry>();
    
    /**
     * 加载缓存配置
     */
    const loadCacheConfig = () => {
      const capConfig = (win as any).Capacitor?.config?.plugins?.ResultCache;
      if (capConfig) {
        cacheConfig = {
          enabled: capConfig.enabled !== false,
          methods: capConfig.methods || defaultCacheConfig.methods,
          defaultTTL: capConfig.defaultTTL || defaultCacheConfig.defaultTTL,
          maxEntries: capConfig.maxEntries || defaultCacheConfig.maxEntries,
        };
        win?.console?.log?.('⚡ [ResultCache] 配置已加载');
      }
    };
    
    loadCacheConfig();
    
    /**
     * 生成缓存键
     */
    const getCacheKey = (pluginId: string, methodName: string, options: any): string => {
      const optionsStr = JSON.stringify(options || {});
      return `${pluginId}.${methodName}:${optionsStr}`;
    };
    
    /**
     * 检查是否应该使用缓存
     */
    const shouldUseCache = (pluginId: string, methodName: string): number | null => {
      if (!cacheConfig.enabled) return null;
      
      const pluginMethods = cacheConfig.methods[pluginId];
      if (pluginMethods && typeof pluginMethods[methodName] === 'number') {
        return pluginMethods[methodName];
      }
      
      return null;
    };
    
    /**
     * 从缓存获取结果
     */
    const getFromCache = (cacheKey: string): any | null => {
      const entry = resultCache.get(cacheKey);
      if (entry && Date.now() < entry.expires) {
        return entry.data;
      }
      // 过期则删除
      if (entry) {
        resultCache.delete(cacheKey);
      }
      return null;
    };
    
    /**
     * 存入缓存
     */
    const setCache = (cacheKey: string, data: any, ttl: number): void => {
      // 清理过期条目
      if (resultCache.size >= cacheConfig.maxEntries) {
        const now = Date.now();
        for (const [key, entry] of resultCache.entries()) {
          if (now >= entry.expires) {
            resultCache.delete(key);
          }
        }
        // 如果还是超过限制，删除最旧的
        if (resultCache.size >= cacheConfig.maxEntries) {
          const firstKey = resultCache.keys().next().value;
          if (firstKey) resultCache.delete(firstKey);
        }
      }
      
      resultCache.set(cacheKey, {
        data,
        expires: Date.now() + ttl,
        optionsHash: cacheKey,
      });
    };
    
    /**
     * 清除指定插件的缓存（写操作后调用）
     */
    const invalidateCache = (pluginId: string, methodName?: string): void => {
      const prefix = methodName ? `${pluginId}.${methodName}:` : `${pluginId}.`;
      for (const key of resultCache.keys()) {
        if (key.startsWith(prefix)) {
          resultCache.delete(key);
        }
      }
    };
    
    // 暴露缓存 API
    (cap as any).invalidateCache = invalidateCache;
    (cap as any).clearCache = () => resultCache.clear();
    (cap as any).getCacheStats = () => ({
      size: resultCache.size,
      maxEntries: cacheConfig.maxEntries,
      entries: Array.from(resultCache.keys()),
    });
    
    /**
     * 写操作方法列表 - 调用这些方法时自动清除对应插件的缓存
     */
    const writeMethods: Record<string, string[]> = {
      'Preferences': ['set', 'remove', 'clear'],
      'Storage': ['set', 'setItem', 'remove', 'removeItem', 'clear'],
      'StatusBar': ['setStyle', 'setBackgroundColor', 'show', 'hide', 'setOverlaysWebView'],
      'App': ['exitApp', 'minimizeApp'],
    };
    
    /**
     * 检查是否是写操作，如果是则清除缓存
     */
    const checkAndInvalidateCache = (pluginId: string, methodName: string): void => {
      const methods = writeMethods[pluginId];
      if (methods && methods.includes(methodName)) {
        invalidateCache(pluginId);
        win?.console?.debug?.(`💾 [Cache] Invalidated: ${pluginId}.*`);
      }
    };
    
    // ==================== 结果缓存支持结束 ====================
    
    /**
     * 判断是否应该使用同步调用
     */
    const shouldUseSync = (pluginId: string, methodName: string): boolean => {
      if (!syncConfig.enabled) return false;
      
      // 检查是否在同步插件列表中
      if (syncConfig.syncPlugins.includes(pluginId)) {
        // 如果指定了具体方法，检查方法是否在列表中
        const methods = syncConfig.syncMethods[pluginId];
        if (methods && methods.length > 0) {
          return methods.includes(methodName);
        }
        return true; // 整个插件都启用同步
      }
      
      return false;
    };
    
    /**
     * 检查同步桥接是否可用
     */
    const isSyncBridgeAvailable = (): boolean => {
      if (getPlatformId(win) === 'android') {
        return typeof (win as any).androidBridge?.callSync === 'function';
      } else if (getPlatformId(win) === 'ios') {
        // iOS 使用 prompt 机制
        return true;
      }
      return false;
    };
    
    /**
     * 同步调用实现
     */
    const callSync = (pluginId: string, methodName: string, options: any): any => {
      const platform = getPlatformId(win);
      
      if (platform === 'android') {
        try {
          const optionsJson = JSON.stringify(options || {});
          const resultJson = (win as any).androidBridge.callSync(
            pluginId, 
            methodName, 
            optionsJson
          );
          const result = JSON.parse(resultJson);
          
          if (result.success) {
            return result.data;
          } else {
            throw new cap.Exception(result.error?.message || 'Sync call failed');
          }
        } catch (e) {
          win?.console?.error('Sync call error:', e);
          throw e;
        }
      } else if (platform === 'ios') {
        // iOS 使用 prompt 同步机制
        const payload = {
          type: 'CapacitorSyncCall',
          pluginId,
          methodName,
          options: options || {},
        };
        
        const resultJson = (win as any).prompt(JSON.stringify(payload));
        if (resultJson) {
          const result = JSON.parse(resultJson);
          if (result.success) {
            return result.data;
          } else {
            throw new cap.Exception(result.error?.message || 'Sync call failed');
          }
        }
        throw new cap.Exception('No response from native');
      }
      
      throw new cap.Exception('Sync bridge not available');
    };
    
    // 暴露同步调用 API
    (cap as any).callSync = callSync;
    (cap as any).isSyncAvailable = isSyncBridgeAvailable;
    
    // ==================== 同步调用支持结束 ====================

    cap.getPlatform = getPlatform;
    cap.isPluginAvailable = (name) => Object.prototype.hasOwnProperty.call(cap.Plugins, name);
    cap.isNativePlatform = isNativePlatform;

    // create the postToNative() fn if needed
    if (getPlatformId(win) === 'android') {
      // android platform
      postToNative = (data) => {
        try {
          win.androidBridge?.postMessage(JSON.stringify(data));
        } catch (e) {
          win?.console?.error(e);
        }
      };
    } else if (getPlatformId(win) === 'ios') {
      // ios platform
      postToNative = (data) => {
        try {
          data.type = data.type ? data.type : 'message';
          win.webkit?.messageHandlers?.bridge?.postMessage(data);
        } catch (e) {
          win?.console?.error(e);
        }
      };
    }

    cap.handleWindowError = (msg, url, lineNo, columnNo, err) => {
      const str = (msg as string).toLowerCase();

      if (str.indexOf('script error') > -1) {
        // Some IE issue?
      } else {
        const errObj: ErrorCallData = {
          type: 'js.error',
          error: {
            message: msg as string,
            url: url,
            line: lineNo,
            col: columnNo,
            errorObject: JSON.stringify(err),
          },
        };

        if (err !== null) {
          cap.handleError(err);
        }

        postToNative?.(errObj);
      }

      return false;
    };

    if (cap.DEBUG) {
      window.onerror = cap.handleWindowError as OnErrorEventHandler;
    }

    initLogger(win, cap);

    /**
     * Send a plugin method call to the native layer
     */
    cap.toNative = (pluginName, methodName, options, storedCallback) => {
      try {
        // ========== 0. 检查写操作并清除缓存 ==========
        checkAndInvalidateCache(pluginName, methodName);
        
        // ========== 1. 检查缓存 ==========
        const cacheTTL = shouldUseCache(pluginName, methodName);
        if (cacheTTL !== null && storedCallback?.resolve) {
          const cacheKey = getCacheKey(pluginName, methodName, options);
          const cachedResult = getFromCache(cacheKey);
          
          if (cachedResult !== null) {
            // 缓存命中，立即返回
            storedCallback.resolve(cachedResult);
            win?.console?.debug?.(`💾 [Cache] ${pluginName}.${methodName} - 0ms (cached)`);
            return '-1';
          }
          
          // 缓存未命中，包装回调以存储结果
          const originalResolve = storedCallback.resolve;
          storedCallback.resolve = (result: any) => {
            setCache(cacheKey, result, cacheTTL);
            originalResolve(result);
          };
        }
        
        // ========== 2. 检查同步调用 ==========
        const bridgeAvailable = isSyncBridgeAvailable();
        const shouldSync = shouldUseSync(pluginName, methodName);
        const hasResolve = !!storedCallback?.resolve;
        const useSync = bridgeAvailable && shouldSync && hasResolve;
        
        // 调试日志（仅在首次调用时输出）
        if (pluginName !== 'Console' && (pluginName === 'Preferences' || pluginName === 'StatusBar')) {
          win?.console?.log?.(`⚡ [SyncBridge Debug] ${pluginName}.${methodName}:`, 
            `bridge=${bridgeAvailable}, shouldSync=${shouldSync}, hasResolve=${hasResolve}, useSync=${useSync}`);
        }
        
        if (useSync) {
          try {
            const startTime = performance.now();
            const result = callSync(pluginName, methodName, options);
            const duration = (performance.now() - startTime).toFixed(2);
            
            // 立即 resolve
            if (storedCallback?.resolve) {
              storedCallback.resolve(result);
            } else if (storedCallback?.callback) {
              storedCallback.callback(result);
            }
            
            // 始终输出同步调用日志（方便调试）
            win?.console?.debug(`⚡ [Sync] ${pluginName}.${methodName} - ${duration}ms`);
            
            return '-1'; // 同步调用不需要真正的 callbackId
          } catch (e) {
            // 同步调用失败，回退到异步
            win?.console?.debug(`[Capacitor] Sync call failed, fallback to async: ${pluginName}.${methodName}`);
          }
        }
        
        // 使用原有的异步方式
        if (typeof postToNative === 'function') {
          let callbackId = '-1';

          if (
            storedCallback &&
            (typeof storedCallback.callback === 'function' || typeof storedCallback.resolve === 'function')
          ) {
            // store the call for later lookup
            callbackId = String(++callbackIdCount);
            // 记录开始时间用于计算异步调用耗时
            (storedCallback as any)._startTime = performance.now();
            (storedCallback as any)._pluginName = pluginName;
            (storedCallback as any)._methodName = methodName;
            callbacks.set(callbackId, storedCallback);
          }

          const callData = {
            callbackId: callbackId,
            pluginId: pluginName,
            methodName: methodName,
            options: options || {},
          };

          if (cap.isLoggingEnabled && pluginName !== 'Console') {
            cap.logToNative(callData);
          }

          // post the call data to native
          postToNative(callData);

          return callbackId;
        } else {
          win?.console?.warn(`implementation unavailable for: ${pluginName}`);
        }
      } catch (e) {
        win?.console?.error(e);
      }

      return '';
    };

    if (win?.androidBridge) {
      win.androidBridge.onmessage = function (event) {
        returnResult(JSON.parse(event.data));
      };
    }

    /**
     * Process a response from the native layer.
     */
    cap.fromNative = (result) => {
      returnResult(result);
    };

    const returnResult = (result: any) => {
      if (cap.isLoggingEnabled && result.pluginId !== 'Console') {
        cap.logFromNative(result);
      }

      // get the stored call, if it exists
      try {
        const storedCall = callbacks.get(result.callbackId);

        if (storedCall) {
          // looks like we've got a stored call
          
          // 输出异步调用耗时日志
          const startTime = (storedCall as any)._startTime;
          const pluginName = (storedCall as any)._pluginName;
          const methodName = (storedCall as any)._methodName;
          if (startTime && pluginName && pluginName !== 'Console') {
            const duration = (performance.now() - startTime).toFixed(2);
            win?.console?.log?.(`📨 [Async] ${pluginName}.${methodName} - ${duration}ms`);
          }

          if (result.error) {
            // ensure stacktraces by copying error properties to an Error
            result.error = Object.keys(result.error).reduce((err, key) => {
              // use any type to avoid importing util and compiling most of .ts files
              (err as any)[key] = (result as any).error[key];
              return err;
            }, new cap.Exception(''));
          }

          if (typeof storedCall.callback === 'function') {
            // callback
            if (result.success) {
              storedCall.callback(result.data);
            } else {
              storedCall.callback(null, result.error);
            }
          } else if (typeof storedCall.resolve === 'function') {
            // promise
            if (result.success) {
              storedCall.resolve(result.data);
            } else {
              storedCall.reject(result.error);
            }

            // no need to keep this stored callback
            // around for a one time resolve promise
            callbacks.delete(result.callbackId);
          }
        } else if (!result.success && result.error) {
          // no stored callback, but if there was an error let's log it
          win?.console?.warn(result.error);
        }

        if (result.save === false) {
          callbacks.delete(result.callbackId);
        }
      } catch (e) {
        win?.console?.error(e);
      }

      // always delete to prevent memory leaks
      // overkill but we're not sure what apps will do with this data
      delete result.data;
      delete result.error;
    };

    cap.nativeCallback = (pluginName, methodName, options, callback) => {
      if (typeof options === 'function') {
        console.warn(`Using a callback as the 'options' parameter of 'nativeCallback()' is deprecated.`);

        callback = options as any;
        options = undefined;
      }

      return cap.toNative?.(pluginName, methodName, options, { callback }) ?? '';
    };

    cap.nativePromise = (pluginName, methodName, options) => {
      return new Promise((resolve, reject) => {
        cap.toNative?.(pluginName, methodName, options, {
          resolve: resolve,
          reject: reject,
        });
      });
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    cap.withPlugin = (_pluginId, _fn) => dummy;

    cap.Exception = CapacitorException;

    initEvents(win, cap);
    initLegacyHandlers(win, cap);
    initVendor(win, cap);

    win.Capacitor = cap;
  }

  initNativeBridge(w);
};

initBridge(
  typeof globalThis !== 'undefined'
    ? (globalThis as WindowCapacitor)
    : typeof self !== 'undefined'
      ? (self as WindowCapacitor)
      : typeof window !== 'undefined'
        ? (window as WindowCapacitor)
        : typeof global !== 'undefined'
          ? (global as WindowCapacitor)
          : ({} as WindowCapacitor),
);

// Export only for tests
export { initBridge };
