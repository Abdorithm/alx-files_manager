import {
  expect, use, should, request,
} from 'chai';
import chaiHttp from 'chai-http';
import app from '../server';
import dbClient from '../utils/db';

use(chaiHttp);
should();

// General APP Endpoints

describe('testing App Status Endpoints', () => {
  describe('GET /status', () => {
    it('returns the status of redis and mongo connection', async () => {
      const response = await request(app).get('/status').send();
      const body = JSON.parse(response.text);

      expect(body).to.eql({ redis: true, db: true });
      expect(response.statusCode).to.equal(200);
    });
  });

  describe('GET /stats', () => {
    before(async () => {
      await dbClient.usersCollection.deleteMany({});
      await dbClient.filesCollection.deleteMany({});
    });

    it('returns number of users and files in db', async () => {
      await dbClient.usersCollection.insertOne({ name: 'Larry' });
      await dbClient.filesCollection.insertOne({ name: 'image.png' });

      const response = await request(app).get('/stats').send();
      const body = JSON.parse(response.text);

      expect(body).to.eql({ users: 1, files: 1 });
      expect(response.statusCode).to.equal(200);
    });
  });
});
