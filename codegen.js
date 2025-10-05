import { Sequelize, DataTypes, Model } from 'sequelize';

const sequelize = new Sequelize('database', 'username', 'password', {
  dialect: 'sqlite',
  storage: 'db.sqlite',
  logging: false
});

class Code extends Model {}
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

async function gen() {
  try {
    await sequelize.sync({ alter: true });
  } catch (syncErr) {
    console.error('Failed to sync DB schema:', syncErr);
  }
  const code = `MLNK-${Math.random().toString(36).slice(2, 10).toUpperCase()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  try {
    await Code.create({ value: code, expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) });
    console.log('Created code:', code);
  } catch (e) {
    if (e.name === 'SequelizeUniqueConstraintError') {
      console.log('Code collision, try again');
    } else {
      console.error('Failed to create code:', e);
      Deno.exit(1);
    }
  }
  const all = await Code.findAll({ order: [['createdAt', 'DESC']] });
  console.log('All Codes:\n', all.map(c => ({ id: c.id, value: c.value, expires_at: c.expires_at })).slice(0, 50));
  await sequelize.close();
}

if (import.meta.main) {
  gen();
}
