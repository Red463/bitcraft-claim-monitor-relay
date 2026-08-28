export const LAZY_ROUTE_RELOAD_KEY = "bitcraft.route-import-reload";

type LazyRouteStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type LazyRouteRecoveryOptions = {
  storage?: LazyRouteStorage;
  reload?: () => void;
};

function isLazyRouteDownloadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|failed to load module script|unable to preload css/i.test(message);
}

function armReloadGuard(storage: LazyRouteStorage): boolean {
  try {
    if (storage.getItem(LAZY_ROUTE_RELOAD_KEY) === "1") return false;
    storage.setItem(LAZY_ROUTE_RELOAD_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export async function loadLazyRoute<T>(
  importer: () => Promise<T>,
  options: LazyRouteRecoveryOptions = {},
): Promise<T> {
  const storage = options.storage ?? window.sessionStorage;
  try {
    const routeModule = await importer();
    try {
      storage.removeItem(LAZY_ROUTE_RELOAD_KEY);
    } catch {
      // Route loading must not depend on browser storage being available.
    }
    return routeModule;
  } catch (error) {
    if (!isLazyRouteDownloadFailure(error) || !armReloadGuard(storage)) throw error;
    (options.reload ?? (() => window.location.reload()))();
    return new Promise<T>(() => undefined);
  }
}
