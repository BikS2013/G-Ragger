declare global {
  interface Window {
    api: typeof import('./api').api
  }
}

export {}
