import { Sequelize, DataTypes, Model } from 'npm:sequelize';
import { hash } from "jsr:@felix/bcrypt";
const sequelize = new Sequelize('database', 'username', 'password', {
  dialect: 'sqlite',
  storage: 'database/db.sqlite',
  logging: false
});
class User extends Model { }
User.init({
  name: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false
  },
  display_name: DataTypes.STRING,
  pswd: {
    type: DataTypes.STRING,
    allowNull: false
  },
  uuid: {
    type: DataTypes.UUID, // uuid bad, will have to switch to chronological system later
    defaultValue: DataTypes.UUIDV4
  },
  token: DataTypes.STRING,
  registered_at: DataTypes.DATE,
  expires_at: DataTypes.DATE,
  role: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'user'
  },
  banned: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  banned_until: DataTypes.DATE,
  deletion_scheduled_at: DataTypes.DATE,
  deleted_at: DataTypes.DATE,
  deletion_initiated_by: DataTypes.STRING
  ,
  system_account: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  system_key: DataTypes.STRING
}, {
  sequelize,
  modelName: 'user'
});
class Post extends Model { }
Post.init({
  content: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  sequelize,
  modelName: 'post'
});
class InboxPost extends Model { }
InboxPost.init({
  content: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  toUserId: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  sequelize,
  modelName: 'inboxpost'
});
class Code extends Model { }
Code.init({
  value: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  expires_at: DataTypes.DATE
}, {
  sequelize,
  modelName: 'code'
});

class ActionLog extends Model { }
ActionLog.init({
  actorId: DataTypes.INTEGER,
  targetUserId: DataTypes.INTEGER,
  action: {
    type: DataTypes.STRING,
    allowNull: false
  },
  details: DataTypes.TEXT,
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  sequelize,
  modelName: 'actionlog'
});
User.hasMany(Post, { foreignKey: 'userId', as: 'posts' });
Post.belongsTo(User, { foreignKey: 'userId', as: 'author' });
User.hasMany(InboxPost, { foreignKey: 'userId', as: 'inbox' });
InboxPost.belongsTo(User, { foreignKey: 'userId', as: 'author' });
User.hasMany(ActionLog, { foreignKey: 'actorId', as: 'actions' });
User.hasMany(ActionLog, { foreignKey: 'targetUserId', as: 'actedUpon' });

await sequelize.sync();

try {
  const found = await User.findOne({ where: { name: 'maelink' } }) || await User.findOne({ where: { name: '@maelink' } });
  if (!found) {
    const keyRaw = crypto.randomUUID() + Math.random().toString(36).slice(2);
    const keyHashed = await hash(keyRaw);
    const _sysUser = await User.create({
      name: 'maelink',
      display_name: '@maelink',
      // store a random hashed password to satisfy non-null constraint; system users login via system_key
      pswd: await hash(crypto.randomUUID() + Math.random().toString(36).slice(2)),
      token: null,
      registered_at: new Date(),
      expires_at: null,
      uuid: crypto.randomUUID(),
      role: 'sysadmin',
      system_account: true,
      system_key: keyHashed
    });
      try {
        const keyFilePath = 'database/MAELINK_SYSTEM_KEY.txt';
        const fileContents = `=== SYSTEM ACCOUNT CREATED ===\nlogin key for @maelink (store this securely): ${keyRaw}\nCreated at: ${new Date().toISOString()}\n`;
        try {
          await Deno.writeTextFile(keyFilePath, fileContents, { mode: 0o600 });
        } catch (_) {
          await Deno.writeTextFile(keyFilePath, fileContents);
        }
        console.log('=== SYSTEM ACCOUNT CREATED ===');
        console.log('login key for @maelink (store this securely):', keyRaw);
        console.log(`Created at: ${new Date().toISOString()}`);
        console.log(`Also saved to file: ${keyFilePath}`);
        console.log('==============================');
      } catch (e) {
        console.error('Failed to write system key to file:', e);
      }
  } else {
    if (!found.system_account || found.role !== 'sysadmin') {
      found.system_account = true;
      found.role = 'sysadmin';
      await found.save();
    }
  }
} catch (e) {
  console.error('Error ensuring system account for @maelink:', e);
}
await sequelize.sync();

export { sequelize, User, Post, Code, ActionLog, InboxPost };