import { RelayMapResourceRegionSession, RelayMapSpatialSession } from "../dist-server/game-data/index.js";

export async function collectMapLiveEvidence(config, { loadBindings, timeoutMs = 60_000 } = {}) {
  const resourceIds = [...new Set(config.scope.resourceIds)];
  const needsSpatial = Boolean(config.scope.includeClaims || config.scope.playerIds.length || config.scope.enemyTypes.length);
  if (!resourceIds.length && !needsSpatial) throw new Error("Select resources, players, enemies or claims to verify");
  let resources, spatial, timeout, settled = false;
  try {
    return await new Promise((resolve, reject) => {
      const snapshots = new Map();
      let spatialSnapshot;
      const fail = error => { settled = true; reject(error instanceof Error ? error : new Error(error)); };
      const finish = () => {
        if (settled || snapshots.size !== resourceIds.length || (needsSpatial && !spatialSnapshot)) return;
        settled = true;
        resolve({
          data: {
            ...(spatialSnapshot?.data ?? { players: [], enemies: [], waystones: [] }),
            resources: resourceIds.flatMap(id => snapshots.get(id).data.resources),
          },
          warnings: spatialSnapshot?.warnings ?? [],
        });
      };
      timeout = setTimeout(() => fail(new Error("Timed out waiting for live map data")), timeoutMs);
      if (resourceIds.length) {
        resources = new RelayMapResourceRegionSession({
          loadBindings,
          onSnapshot(snapshot) {
            if (snapshot.warnings.length) { fail(new Error(snapshot.warnings.join("; "))); return; }
            snapshots.set(snapshot.resourceId, snapshot);
            finish();
          },
          onStatus: status => fail(new Error(status.warning)),
          onResourceFailure: (_id, error) => fail(error),
          onFailure: fail,
        });
        void resources.start({ ...config, regionId: config.scope.regionId }).then(async () => {
          for (const resourceId of resourceIds) {
            if (settled) break;
            await resources.subscribe(resourceId, config.generation);
          }
        }).catch(fail);
      }
      if (needsSpatial) {
        spatial = new RelayMapSpatialSession({
          loadBindings, onSnapshot(snapshot) { spatialSnapshot = snapshot; finish(); }, onFailure: fail,
        });
        void spatial.start(config).then(async () => {
          // Binding loading can finish after the bounded probe has already failed.
          if (settled) await spatial.stop();
        }).catch(fail);
      }
    });
  } finally {
    clearTimeout(timeout);
    settled = true;
    await Promise.all([resources?.stop(), spatial?.stop()]);
  }
}
