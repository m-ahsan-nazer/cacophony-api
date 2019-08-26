/*
cacophony-api: The Cacophony Project API server
Copyright (C) 2018  The Cacophony Project

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

"use strict";

const _ = require("lodash");
const sequelize = require("sequelize");
const Op = sequelize.Op;

const { AuthorizationError } = require("../api/customErrors");

module.exports = function(sequelize, DataTypes) {
  const name = "File";

  const attributes = {
    type: DataTypes.STRING,
    fileKey: DataTypes.STRING,
    details: DataTypes.JSONB
  };

  const File = sequelize.define(name, attributes);

  File.apiSettableFields = ["type", "details"];

  //---------------
  // CLASS METHODS
  //---------------

  File.buildSafely = function(fields) {
    return File.build(_.pick(fields, File.apiSettableFields));
  };

  File.addAssociations = function(models) {
    models.File.belongsTo(models.User);
  };

  /**
   * Return one or more files for a user matching the query
   * arguments given.
   */
  File.query = async function(where, offset, limit, order) {
    if (order == null) {
      order = [["id", "DESC"]];
    }

    const q = {
      where: where,
      order: order,
      attributes: { exclude: ["updatedAt", "fileKey"] },
      limit: limit,
      offset: offset
    };
    return this.findAndCountAll(q);
  };

  File.deleteIfAllowedElseThrow = async function(user, file) {
    if (!user.hasGlobalWrite() && user.id != file.UserId) {
      throw new AuthorizationError(
        "The user does not own that file and is not a global admin!"
      );
    }
    await file.destroy();
  };

  File.getMultiple = async function(ids) {
    return this.findAll({
      where: {
        id: {
          [Op.in]: ids
        }
      }
    });
  };

  return File;
};
