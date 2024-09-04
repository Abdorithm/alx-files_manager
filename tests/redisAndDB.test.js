import { expect, use, should } from 'chai';
import chaiHttp from 'chai-http';
import { promisify } from 'util';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

use(chaiHttp);
should();

// redisClient

describe('testing the clients for MongoDB and Redis', () => {
  describe('redis Client', () => {
    before(async () => {
      await redisClient.client.flushall('ASYNC');
    });

    after(async () => {
      await redisClient.client.flushall('ASYNC');
    });

    it('shows that connection is alive', async () => {
      expect(redisClient.isAlive()).to.equal(true);
    });

    it('can set and get a key', async () => {
      await redisClient.set('testKey', 'testValue', 10);
      expect(await redisClient.get('testKey')).to.equal('testValue');
    });
  });

  describe('db Client', () => {
    before(async () => {
      await dbClient.usersCollection.deleteMany({});
      await dbClient.filesCollection.deleteMany({});
    });

    after(async () => {
      await dbClient.usersCollection.deleteMany({});
      await dbClient.filesCollection.deleteMany({});
    });

    it('shows that connection is alive', () => {
      expect(dbClient.isAlive()).to.equal(true);
    });

    it('can count users and files', async () => {
      await dbClient.usersCollection.insertOne({ name: 'TestUser' });
      await dbClient.filesCollection.insertOne({ name: 'TestFile' });
      
      expect(await dbClient.nbUsers()).to.equal(1);
      expect(await dbClient.nbFiles()).to.equal(1);
    });
  });
});
