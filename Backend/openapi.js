const point = {
  type: 'object',
  required: ['lat', 'lng'],
  properties: { lat: { type: 'number', minimum: 12.8, maximum: 13.18 }, lng: { type: 'number', minimum: 77.45, maximum: 77.8 }, hour: { type: 'integer', minimum: 0, maximum: 23, default: 12 } },
};
export default {
  openapi: '3.0.3',
  info: { title: 'SafeTour API', version: '1.0.0', description: 'Historical/demo safety data; not a live crime feed.' },
  servers: [{ url: '/api/v1' }],
  paths: {
    '/health': { get: { responses: { 200: { description: 'Service health' } } } },
    '/data-status': { get: { responses: { 200: { description: 'Data freshness and provenance' } } } },
    '/score': { get: { parameters: [{ in: 'query', name: 'lat', required: true, schema: point.properties.lat }, { in: 'query', name: 'lng', required: true, schema: point.properties.lng }, { in: 'query', name: 'hour', schema: point.properties.hour }], responses: { 200: { description: 'Explainable SafeScore' }, 400: { description: 'Invalid coordinates' } } } },
    '/heatmap': { get: { parameters: [{ in: 'query', name: 'band', schema: { type: 'string', enum: ['Morning', 'Afternoon', 'Evening', 'Night'] } }], responses: { 200: { description: 'Persisted risk cells' } } } },
    '/areas': { get: { responses: { 200: { description: 'Area incident ranking' } } } },
  },
};
