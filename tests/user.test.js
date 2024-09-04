import {
  expect, use, should, request,
} from 'chai';
import chaiHttp from 'chai-http';
import sinon from 'sinon';
import { ObjectId } from 'mongodb';
import app from '../server';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

use(chaiHttp);
should();

// User Endpoints 

describe('testing User Endpoints', () => {
  const credentials = 'Basic YWxpY2VAZXhhbXBsZS5jb206c2VjdXJlUGFzczEyMyE=';
  const user = {
    email: 'alice@example.com',
    password: 'securePass123!',
  };

  before(async () => {
    await redisClient.client.flushall('ASYNC');
    await dbClient.usersCollection.deleteMany({});
  });

  after(async () => {
    await redisClient.client.flushall('ASYNC');
    await dbClient.usersCollection.deleteMany({});
  });

  describe('POST /users', () => {
    it('creates a new user successfully', async () => {
      const response = await request(app).post('/users').send(user);
      const body = JSON.parse(response.text);
      expect(body.email).to.equal(user.email);
      expect(body).to.have.property('id');
      expect(response.statusCode).to.equal(201);
    });
  });

  describe('GET /connect', () => {
    it('returns a token for valid credentials', async () => {
      const response = await request(app)
        .get('/connect')
        .set('Authorization', credentials)
        .send();
      const body = JSON.parse(response.text);
      expect(body).to.have.property('token');
      expect(response.statusCode).to.equal(200);
    });
  });
});
