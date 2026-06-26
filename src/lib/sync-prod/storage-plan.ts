export interface BucketRef {
  id: string;
  public: boolean;
}

export interface StorageObjectRef {
  bucket: string;
  name: string;
}

export interface StoragePlan {
  bucketsToCreate: BucketRef[];
  objectsToCopy: StorageObjectRef[];
  objectsToDelete: StorageObjectRef[];
}

const key = (o: StorageObjectRef) => `${o.bucket}/${o.name}`;

export function planStorageSync(
  devBuckets: BucketRef[],
  prodBuckets: BucketRef[],
  devObjects: StorageObjectRef[],
  prodObjects: StorageObjectRef[],
): StoragePlan {
  const prodBucketIds = new Set(prodBuckets.map((b) => b.id));
  const devKeys = new Set(devObjects.map(key));
  return {
    bucketsToCreate: devBuckets.filter((b) => !prodBucketIds.has(b.id)),
    objectsToCopy: [...devObjects],
    objectsToDelete: prodObjects.filter((o) => !devKeys.has(key(o))),
  };
}
