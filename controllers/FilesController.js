import { ObjectId } from 'mongodb';
import { env } from 'process';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import mime from 'mime-types';
import fs from 'fs';
import Queue from 'bull';
import redisClient from '../utils/redis';
import dbClient from '../utils/db';

const fileQueue = new Queue('fileQueue', {
  redis: {
    host: '127.0.0.1',
    port: 6379,
  },
});

class FilesController {
  static async postUpload(req, res) {
    const user = await this.retrieveUserBasedOnToken(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { name, type, parentId, isPublic, data } = req.body;
    const validTypes = ['folder', 'file', 'image'];

    if (!name) return res.status(400).json({ error: 'Missing name' });
    if (!type || !validTypes.includes(type)) return res.status(400).json({ error: 'Missing type' });
    if (!data && type !== 'folder') return res.status(400).json({ error: 'Missing data' });

    if (parentId) {
      const files = dbClient.db.collection('files');
      const parent = await files.findOne({ _id: ObjectId(parentId) });
      if (!parent) return res.status(400).json({ error: 'Parent not found' });
      if (parent.type !== 'folder') return res.status(400).json({ error: 'Parent is not a folder' });
    }

    const newFile = {
      name,
      type,
      parentId: parentId || 0,
      isPublic: isPublic || false,
      userId: user._id.toString(),
    };

    if (type === 'folder') {
      const files = dbClient.db.collection('files');
      const result = await files.insertOne(newFile);
      newFile.id = result.insertedId;
      delete newFile._id;
      return res.status(201).json(newFile);
    } else {
      const storeFolderPath = env.FOLDER_PATH || '/tmp/files_manager';
      const fileName = uuidv4();
      const filePath = path.join(storeFolderPath, fileName);

      newFile.localPath = filePath;
      const decodedData = Buffer.from(data, 'base64');

      await this.ensureDirectoryExists(storeFolderPath);
      await this.writeToFile(res, filePath, decodedData, newFile);
    }
  }

  static async writeToFile(res, filePath, data, newFile) {
    await fs.promises.writeFile(filePath, data, 'utf-8');

    const files = dbClient.db.collection('files');
    const result = await files.insertOne(newFile);
    const writeResp = { ...newFile, id: result.insertedId };
    delete writeResp._id;
    delete writeResp.localPath;

    if (writeResp.type === 'image') {
      fileQueue.add({ userId: writeResp.userId, fileId: writeResp.id });
    }

    res.status(201).json(writeResp);
  }

  static async retrieveUserBasedOnToken(req) {
    const authToken = req.header('X-Token');
    if (!authToken) return null;

    const token = `auth_${authToken}`;
    const userId = await redisClient.get(token);
    if (!userId) return null;

    const users = dbClient.db.collection('users');
    return users.findOne({ _id: ObjectId(userId) });
  }

  static async getShow(req, res) {
    const { id } = req.params;
    const user = await this.retrieveUserBasedOnToken(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const files = dbClient.db.collection('files');
    const file = await files.findOne({ _id: ObjectId(id), userId: user._id });
    
    if (!file) return res.status(404).json({ error: 'Not found' });
    
    const { _id, localPath, ...fileData } = file;
    res.status(200).json({ id: _id, ...fileData });
  }

  static async getIndex(req, res) {
    const user = await this.retrieveUserBasedOnToken(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { parentId, page = 1 } = req.query;
    const files = dbClient.db.collection('files');

    const pageSize = 20;
    const skip = (page - 1) * pageSize;

    const query = parentId
      ? { userId: user._id.toString(), parentId }
      : { userId: user._id.toString() };

    const result = await files.aggregate([
      { $match: query },
      { $skip: skip },
      { $limit: pageSize },
    ]).toArray();

    const finalResult = result.map(({ _id, localPath, ...file }) => ({ id: _id, ...file }));
    res.status(200).json(finalResult);
  }

  static putPublish(req, res) {
    this.pubSubHelper(req, res, true);
  }

  static putUnpublish(req, res) {
    this.pubSubHelper(req, res, false);
  }

  static async pubSubHelper(req, res, isPublic) {
    const { id } = req.params;
    const user = await this.retrieveUserBasedOnToken(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const files = dbClient.db.collection('files');
    const file = await files.findOne({ userId: user._id, _id: ObjectId(id) });
    
    if (!file) return res.status(404).json({ error: 'Not found' });
    
    await files.updateOne({ _id: ObjectId(id) }, { $set: { isPublic } });
    const updatedFile = await files.findOne({ _id: ObjectId(id) });
    
    const { _id, localPath, ...fileData } = updatedFile;
    res.status(200).json({ id: _id, ...fileData });
  }

  static async getFile(req, res) {
    const { id } = req.params;
    const { size } = req.query;
    
    if (!id) return res.status(404).json({ error: 'Not found' });

    const user = await this.retrieveUserBasedOnToken(req);
    const files = dbClient.db.collection('files');
    const file = await files.findOne({ _id: ObjectId(id) });

    if (!file) return res.status(404).json({ error: 'Not found' });
    if (!user && !file.isPublic) return res.status(404).json({ error: 'Not found' });
    if (!file.isPublic && user && file.userId !== user._id.toString()) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (file.type === 'folder') return res.status(400).json({ error: "A folder doesn't have content" });

    const filePath = size && file.type === 'image'
      ? `${file.localPath}_${size}`
      : file.localPath;

    if (!(await this.pathExists(filePath))) return res.status(404).json({ error: 'Not found' });

    res.set('Content-Type', mime.lookup(file.name));
    res.status(200).sendFile(filePath);
  }

  static pathExists(path) {
    return new Promise((resolve) => {
      fs.access(path, fs.constants.F_OK, (err) => resolve(!err));
    });
  }

  static async ensureDirectoryExists(dirPath) {
    const exists = await this.pathExists(dirPath);
    if (!exists) {
      await fs.promises.mkdir(dirPath, { recursive: true });
    }
  }
}

export default FilesController;
