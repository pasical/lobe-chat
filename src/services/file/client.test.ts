import { eq } from 'drizzle-orm';
import { Mock, beforeEach, describe, expect, it } from 'vitest';

import { clientDB } from '@/database/client/db';
import { migrate } from '@/database/client/migrate';
import { files, globalFiles, users } from '@/database/schemas';
import { clientS3Storage } from '@/services/file/ClientS3';
import { UploadFileParams } from '@/types/files';

import { ClientService } from './client';

const userId = 'file-user';

const fileService = new ClientService(userId);

const mockFile = {
  name: 'mock.png',
  fileType: 'image/png',
  size: 1,
  url: '',
};

beforeEach(async () => {
  await migrate();

  await clientDB.delete(users);
  // 创建测试数据
  await clientDB.transaction(async (tx) => {
    await tx.insert(users).values({ id: userId });
  });
});

describe('FileService', () => {
  it('createFile should save the file to the database', async () => {
    const localFile: UploadFileParams = {
      name: 'test',
      fileType: 'image/png',
      url: '',
      size: 1,
      hash: '123',
    };

    await clientS3Storage.putObject(
      '123',
      new File([new ArrayBuffer(1)], 'test.png', { type: 'image/png' }),
    );

    const result = await fileService.createFile(localFile);

    expect(result).toMatchObject({ url: 'data:image/png;base64,AA==' });
  });

  it('removeFile should delete the file from the database', async () => {
    const fileId = '1';
    await clientDB.insert(files).values({ id: fileId, userId, ...mockFile });

    await fileService.removeFile(fileId);

    const result = await clientDB.query.files.findFirst({
      where: eq(files.id, fileId),
    });

    expect(result).toBeUndefined();
  });

  describe('getFile', () => {
    it('should retrieve and convert local file info to FilePreview', async () => {
      const fileId = 'rwlijweled';
      const file = {
        fileType: 'image/png',
        size: 1,
        name: 'test.png',
        url: 'idb://12312/abc.png',
        hashId: '123tttt',
      };

      await clientDB.insert(globalFiles).values(file);

      await clientDB.insert(files).values({
        id: fileId,
        userId,
        ...file,
        createdAt: new Date(1),
        updatedAt: new Date(2),
        fileHash: file.hashId,
      });

      await clientS3Storage.putObject(
        file.hashId,
        new File([new ArrayBuffer(1)], file.name, { type: file.fileType }),
      );

      const result = await fileService.getFile(fileId);

      expect(result).toMatchObject({
        createdAt: new Date(1),
        id: 'rwlijweled',
        size: 1,
        type: 'image/png',
        name: 'test.png',
        updatedAt: new Date(2),
      });
    });

    it('should throw an error when the file is not found', async () => {
      const fileId = 'non-existent';

      const getFilePromise = fileService.getFile(fileId);

      await expect(getFilePromise).rejects.toThrow('file not found');
    });
  });
});
