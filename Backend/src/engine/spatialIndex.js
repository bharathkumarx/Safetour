import KDBush from 'kdbush';
import { around } from 'geokdbush';

const coordinates = (item) => {
  const location = item.location?.coordinates;
  return location ? [location[0], location[1]] : [item.longitude ?? item.lng, item.latitude ?? item.lat];
};

/** Build a geographic point index for incidents or plain {lat,lng} objects. */
export function createSpatialIndex(items = []) {
  const index = new KDBush(items.length);
  items.forEach((item) => {
    const [lng, lat] = coordinates(item);
    index.add(lng, lat);
  });
  index.finish();
  return { index, items };
}

/** Find incidents within radiusMeters of a point. */
export function nearby(indexData, lat, lng, radiusMeters = 1000) {
  if (!indexData?.index) return [];
  const ids = around(indexData.index, lng, lat, Infinity, radiusMeters / 1000);
  return ids.map((id) => indexData.items[id]);
}

export { coordinates };
export const buildSpatialIndex = createSpatialIndex;
export const findNearby = nearby;
