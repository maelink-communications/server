import { Sequelize, DataTypes, Model } from 'npm:sequelize';
const sequelize = new Sequelize('database', 'username', 'password', {
  dialect: 'sqlite',
  storage: 'db.sqlite',
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
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4
  },
  token: DataTypes.STRING,
  registered_at: DataTypes.DATE,
  expires_at: DataTypes.DATE
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
User.hasMany(Post, { foreignKey: 'userId', as: 'posts' });
Post.belongsTo(User, { foreignKey: 'userId', as: 'author' });
await sequelize.sync();

export { sequelize, User, Post, Code };