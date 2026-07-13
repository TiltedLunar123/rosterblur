// Global chrome API mock. shared.js storage helpers use the callback
// form of chrome.storage.local; the mock supports both forms.

const backing = { local: {} };

const makeArea = (area) => ({
  get: jest.fn((keys, cb) => {
    let result;
    if (typeof keys === "string") {
      result = { [keys]: backing[area][keys] };
    } else if (Array.isArray(keys)) {
      result = {};
      for (const k of keys) result[k] = backing[area][k];
    } else {
      result = { ...backing[area] };
    }
    if (typeof cb === "function") { cb(result); return undefined; }
    return Promise.resolve(result);
  }),
  set: jest.fn((obj, cb) => {
    Object.assign(backing[area], obj);
    if (typeof cb === "function") { cb(); return undefined; }
    return Promise.resolve();
  }),
  remove: jest.fn((keys, cb) => {
    for (const k of Array.isArray(keys) ? keys : [keys]) delete backing[area][k];
    if (typeof cb === "function") { cb(); return undefined; }
    return Promise.resolve();
  })
});

global.chrome = {
  runtime: {
    id: "test-extension-id",
    lastError: null,
    sendMessage: jest.fn(),
    onMessage: { addListener: jest.fn() }
  },
  storage: {
    local: makeArea("local"),
    onChanged: { addListener: jest.fn() }
  }
};

global.__resetChromeStorage = () => { backing.local = {}; };
