import app from './web/app';

const port = parseInt(process.env.PORT || '3000');

console.log(`Starting server on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
