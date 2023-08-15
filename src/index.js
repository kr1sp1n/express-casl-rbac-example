const { Ability, ForbiddenError } = require('@casl/ability')
const { permittedFieldsOf } = require('@casl/ability/extra')
const { Sequelize, Model, DataTypes } = require('sequelize')
const sequelize = new Sequelize('sqlite::memory:')

ForbiddenError.setDefaultMessage('Not authorized')

// Models:

const idField = {
  type: DataTypes.UUID,
  defaultValue: DataTypes.UUIDV4,
  primaryKey: true
}

class User extends Model {}
User.init({
  id: idField,
  email: DataTypes.STRING
}, { sequelize, modelName: 'user' })

class Role extends Model {}
Role.init({
  id: idField,
  name: DataTypes.STRING
}, { sequelize, modelName: 'role' })

class Permission extends Model {}
Permission.init({
  id: idField,
  action: {
    type: DataTypes.STRING
  },
  subject: {
    type: DataTypes.STRING
  },
  fields: {
    type: DataTypes.JSON
  }
}, { sequelize, modelName: 'permission' })


// Associations:

User.belongsToMany(Role, { through: 'users_roles' })
Role.belongsToMany(User, { through: 'users_roles' })
Permission.belongsToMany(Role, { through: 'roles_permissions' })
Role.belongsToMany(Permission, { through: 'roles_permissions' })

function createAbility (rules) { return new Ability(rules) }

function abilityByRoleNameFinder (abilities) {
  return (roleName) => abilities.find((a) => a.roleName === roleName)
}

async function main () {
  const userFields = Object.entries(User.getAttributes()).map(([key, value]) => {
    return value.fieldName
  })
  // Create tables:
  await sequelize.sync({ force: true })

  // Seeds:
  const user = await User.create({
    email: 'user@example.org'
  })

  const adminRole = await Role.create({
    name: 'admin'
  })

  const adminRolePermission = await Permission.create({
    action: 'manage',
    subject: 'all'
  })

  await adminRole.addPermission(adminRolePermission)

  // anonymous user:
  const guestRole = await Role.create({
    name: 'guest',
    permissions: [{ action: 'read', subject: 'User', fields: ['email'] }]
  }, {
    include: [Permission]
  })

  await user.addRoles([adminRole])

  const roles = await Role.findAll({
    include: {
      model: Permission
    }
  })

  // Generate abilities for all roles:
  const abilities = roles.map((role) => {
    return {
      roleName: role.name,
      ability: createAbility(role.permissions)
    }
  })

  const abilityByRoleName = abilityByRoleNameFinder(abilities)

  // Server:
  const express = require('express')
  const app = express()
  const port = 3000

  const errorHandler = (err, req, res, next) => {
    if (res.headersSent) return next(err)
    res.status(500).send({ error: err.message })
  }

  const casl = (req, res, next) => {
    const role = req.query.role || 'guest'
    const item = abilityByRoleName(role) || abilityByRoleName('guest')
    if (item) {
      req.user = {
        ability: item.ability
      }
    }
    next()
  }

  app.use(casl)

  app.get('/users', async (req, res) => {
    ForbiddenError.from(req.user.ability).throwUnlessCan('read', 'User')
    // Filter data by permitted fields:
    const fieldOptions = { fieldsFrom: (rule) => rule.fields || userFields }
    const permittedFields = permittedFieldsOf(req.user.ability, 'read', 'User', fieldOptions)
    const users = await User.findAll({ attributes: permittedFields })
    res.send(users)
  })

  app.use(errorHandler)

  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
  })
}

main().catch(console.error)
