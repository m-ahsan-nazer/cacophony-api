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

const mime = require("mime");
const moment = require("moment-timezone");
const Sequelize = require("sequelize");
const Op = Sequelize.Op;
const assert = require("assert");
const uuidv4 = require("uuid/v4");

const util = require("./util/util");
const validation = require("./util/validation");
const _ = require("lodash");
const { AuthorizationError } = require("../api/customErrors");

module.exports = function(sequelize, DataTypes) {
  const name = "Recording";

  const attributes = {
    // recording metadata.
    type: DataTypes.STRING,
    duration: DataTypes.INTEGER,
    recordingDateTime: DataTypes.DATE,
    location: {
      type: DataTypes.GEOMETRY,
      set: util.geometrySetter,
      validate: {
        isLatLon: validation.isLatLon
      }
    },
    relativeToDawn: DataTypes.INTEGER,
    relativeToDusk: DataTypes.INTEGER,
    version: DataTypes.STRING,
    additionalMetadata: DataTypes.JSONB,
    comment: DataTypes.STRING,
    public: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },

    // Raw file data.
    rawFileKey: DataTypes.STRING,
    rawMimeType: DataTypes.STRING,

    // Processing fields. Fields set by and for the processing.
    fileKey: DataTypes.STRING,
    fileMimeType: DataTypes.STRING,
    processingStartTime: DataTypes.DATE,
    processingMeta: DataTypes.JSONB,
    processingState: DataTypes.STRING,
    passedFilter: DataTypes.BOOLEAN,
    jobKey: DataTypes.STRING,

    // Battery relevant fields.
    batteryLevel: DataTypes.DOUBLE,
    batteryCharging: DataTypes.STRING,
    airplaneModeOn: DataTypes.BOOLEAN
  };

  const Recording = sequelize.define(name, attributes);

  //---------------
  // CLASS METHODS
  //---------------
  const models = sequelize.models;

  Recording.buildSafely = function(fields) {
    return Recording.build(_.pick(fields, Recording.apiSettableFields));
  };

  Recording.Perms = Object.freeze({
    DELETE: "delete",
    TAG: "tag",
    VIEW: "view",
    UPDATE: "update",

    all: function() {
      return Object.values(this).filter(v => typeof v === "string");
    },

    isValid: function(p) {
      return this.all().includes(p);
    }
  });

  Recording.addAssociations = function(models) {
    models.Recording.belongsTo(models.Group);
    models.Recording.belongsTo(models.Device);
    models.Recording.hasMany(models.Tag);
    models.Recording.hasMany(models.Track);
  };

  Recording.isValidTagMode = function(mode) {
    return validTagModes.includes(mode);
  };

  /**
   * Return a recording for processing under a transaction
   * and sets the processingStartTime and jobKey for recording
   * arguments given.
   */
  Recording.getOneForProcessing = async function(type, state) {
    return sequelize
      .transaction(function(t) {
        return Recording.findOne({
          where: {
            type: type,
            processingState: state,
            processingStartTime: null
          },
          attributes: models.Recording.processingAttributes,
          order: [["recordingDateTime", "DESC"]],
          skipLocked: true,
          lock: t.LOCK.UPDATE,
          transaction: t
        }).then(async function(recording) {
          const date = new Date();
          recording.set(
            {
              jobKey: uuidv4(),
              processingStartTime: date.toISOString()
            },
            {
              transaction: t
            }
          );
          recording.save({
            transaction: t
          });
          return recording;
        });
      })
      .then(function(result) {
        return result;
      })
      .catch(() => {
        return null;
      });
  };

  /**
   * Return a single recording for a user.
   */
  Recording.get = async function(user, id, permission, options = {}) {
    if (!Recording.Perms.isValid(permission)) {
      throw "valid permission must be specified (e.g. models.Recording.Perms.VIEW)";
    }

    const query = {
      where: {
        [Op.and]: [
          {
            id: id
          }
        ]
      },
      include: [
        {
          model: models.Tag,
          attributes: models.Tag.userGetAttributes,
          include: [
            {
              association: "tagger",
              attributes: ["username"]
            }
          ]
        },
        {
          model: models.Device,
          where: {},
          attributes: ["devicename", "id"]
        }
      ],
      attributes: this.userGetAttributes.concat(["rawFileKey"])
    };

    if (options.type) {
      query.where[Op.and].push({
        type: options.type
      });
    }

    const recording = await this.findOne(query);
    if (!recording) {
      return null;
    }
    const userPermissions = await recording.getUserPermissions(user);
    if (!userPermissions.includes(permission)) {
      throw new AuthorizationError(
        "The user does not have permission to view this file"
      );
    }

    recording.filterData(
      Recording.makeFilterOptions(user, options.filterOptions)
    );
    return recording;
  };

  /**
   * Deletes a single recording if the user has permission to do so.
   */
  Recording.deleteOne = async function(user, id) {
    const recording = await Recording.get(user, id, Recording.Perms.DELETE);
    if (!recording) {
      return false;
    }
    await recording.destroy();
    return true;
  };

  /**
   * Updates a single recording if the user has permission to do so.
   */
  Recording.updateOne = async function(user, id, updates) {
    for (const key in updates) {
      if (apiUpdatableFields.indexOf(key) == -1) {
        return false;
      }
    }

    const recording = await Recording.get(user, id, Recording.Perms.UPDATE);
    if (!recording) {
      return false;
    }
    await recording.update(updates);
    return true;
  };

  Recording.makeFilterOptions = function(user, options = {}) {
    if (typeof options.latLongPrec != "number") {
      options.latLongPrec = 100;
    }
    if (!user.hasGlobalWrite()) {
      options.latLongPrec = Math.max(options.latLongPrec, 100);
    }
    return options;
  };

  // local
  const recordingsFor = async function(user) {
    if (user.hasGlobalRead()) {
      return null;
    }
    const deviceIds = await user.getDeviceIds();
    const groupIds = await user.getGroupsIds();
    return {
      [Op.or]: [
        {
          public: true
        },
        {
          GroupId: {
            [Op.in]: groupIds
          }
        },
        {
          DeviceId: {
            [Op.in]: deviceIds
          }
        }
      ]
    };
  };

  //------------------
  // INSTANCE METHODS
  //------------------

  Recording.prototype.getFileBaseName = function() {
    return moment(new Date(this.recordingDateTime))
      .tz("Pacific/Auckland")
      .format("YYYYMMDD-HHmmss");
  };

  Recording.prototype.getRawFileName = function() {
    return this.getFileBaseName() + this.getRawFileExt();
  };

  Recording.prototype.getFileName = function() {
    return this.getFileBaseName() + this.getFileExt();
  };

  Recording.prototype.getRawFileExt = function() {
    if (this.rawMimeType == "application/x-cptv") {
      return ".cptv";
    }
    const ext = mime.getExtension(this.rawMimeType);
    if (ext) {
      return "." + ext;
    }
    switch (this.type) {
      case "thermalRaw":
        return ".cptv";
      case "audio":
        return ".mpga";
      default:
        return "";
    }
  };

  /* eslint-disable indent */
  Recording.prototype.getActiveTracksTagsAndTagger = async function() {
    return await this.getTracks({
      where: {
        archivedAt: null
      },
      include: [
        {
          model: models.TrackTag,
          include: [
            {
              model: models.User,
              attributes: ["username"]
            }
          ],
          attributes: {
            exclude: ["UserId"]
          }
        }
      ]
    });
  };
  /* eslint-enable indent */

  /**
   * Returns JSON describing what the user can do to the recording.
   * Permission types: DELETE, TAG, VIEW, UPDATE
   * //TODO This will be edited in the future when recordings can be public.
   */
  Recording.prototype.getUserPermissions = async function(user) {
    if (
      user.hasGlobalWrite() ||
      (await user.isInGroup(this.GroupId)) ||
      (await user.canAccessDevice(this.Device.id))
    ) {
      return [
        Recording.Perms.DELETE,
        Recording.Perms.TAG,
        Recording.Perms.VIEW,
        Recording.Perms.UPDATE
      ];
    }
    if (user.hasGlobalRead()) {
      return [Recording.Perms.VIEW];
    }
    return [];
  };

  // Bulk update recording values. Any new additionalMetadata fields
  // will be merged.
  Recording.prototype.mergeUpdate = function(newValues) {
    for (const name in newValues) {
      const newValue = newValues[name];
      if (name == "additionalMetadata") {
        this.mergeAdditionalMetadata(newValue);
      } else {
        this.set(name, newValue);
      }
    }
  };

  // Update additionalMetadata fields with new values supplied.
  Recording.prototype.mergeAdditionalMetadata = function(newValues) {
    const meta = this.additionalMetadata || {};
    for (const name in newValues) {
      meta[name] = newValues[name];
    }
    this.additionalMetadata = meta;
  };

  Recording.prototype.getFileExt = function() {
    if (this.fileMimeType == "video/mp4") {
      return ".mp4";
    }
    const ext = mime.getExtension(this.fileMimeType);
    if (ext) {
      return "." + ext;
    }
    return "";
  };

  Recording.prototype.filterData = function(options) {
    if (this.location) {
      this.location.coordinates = reduceLatLonPrecision(
        this.location.coordinates,
        options.latLongPrec
      );
    }
  };

  function reduceLatLonPrecision(latLon, prec) {
    assert(latLon.length == 2);
    const resolution = (prec * 360) / 40000000;
    const half_resolution = resolution / 2;
    return latLon.map(val => {
      val = val - (val % resolution);
      if (val > 0) {
        val += half_resolution;
      } else {
        val -= half_resolution;
      }
      return val;
    });
  }

  // Returns all active tracks for the recording which are not archived.
  Recording.prototype.getActiveTracks = async function() {
    const tracks = await this.getTracks({
      where: {
        archivedAt: null
      },
      include: [
        {
          model: models.TrackTag
        }
      ]
    });
    return tracks;
  };

  // reprocess a recording and set all active tracks to archived
  Recording.prototype.reprocess = async function() {
    const tags = await this.getTags();
    if (tags.length > 0) {
      const meta = this.additionalMetadata || {};
      meta["oldTags"] = tags;
      this.additionalMetadata = meta;
      await this.save();
    }

    await models.Tag.destroy({
      where: {
        RecordingId: this.id
      }
    });

    models.Track.update(
      {
        archivedAt: Date.now()
      },
      {
        where: {
          RecordingId: this.id,
          archivedAt: null
        }
      }
    );

    const state = Recording.processingStates[this.type][0];
    await this.update({
      processingStartTime: null,
      processingState: state
    });
  };

  // Return a specific track for the recording.
  Recording.prototype.getTrack = async function(trackId) {
    const track = await models.Track.findByPk(trackId);
    if (!track) {
      return null;
    }

    // Ensure track belongs to this recording.
    if (track.RecordingId !== this.id) {
      return null;
    }

    return track;
  };

  Recording.queryBuilder = function() {};

  Recording.queryBuilder.prototype.init = async function(
    user,
    where,
    tagMode,
    tags,
    offset,
    limit,
    order
  ) {
    if (!where) {
      where = {};
    }

    delete where._tagged; // remove legacy tag mode selector (if included)

    if (!offset) {
      offset = 0;
    }
    if (!limit) {
      limit = 300;
    }
    if (!order) {
      order = [
        // Sort by recordingDatetime but handle the case of the
        // timestamp being missing and fallback to sorting by id.
        [
          sequelize.fn(
            "COALESCE",
            sequelize.col("recordingDateTime"),
            "1970-01-01"
          ),
          "DESC"
        ],
        ["id", "DESC"]
      ];
    }
    this.query = {
      where: {
        [Op.and]: [
          where, // User query
          await recordingsFor(user),
          sequelize.literal(Recording.queryBuilder.handleTagMode(tagMode, tags))
        ]
      },
      order: order,
      include: [
        {
          model: models.Group,
          attributes: ["groupname"]
        },
        {
          model: models.Tag,
          attributes: ["what", "detail", "automatic", "taggerId"],
          required: false
        },
        {
          model: models.Track,
          where: {
            archivedAt: null
          },
          attributes: ["id"],
          required: false,
          include: [
            {
              model: models.TrackTag,
              attributes: ["what", "automatic", "UserId"],
              required: false
            }
          ]
        },
        {
          model: models.Device,
          attributes: ["id", "devicename"]
        }
      ],
      limit: limit,
      offset: offset,
      attributes: Recording.queryGetAttributes
    };

    return this;
  };

  Recording.queryBuilder.handleTagMode = (tagMode, tagWhatsIn) => {
    const tagWhats = tagWhatsIn && tagWhatsIn.length > 0 ? tagWhatsIn : null;
    if (!tagMode) {
      tagMode = tagWhats ? "tagged" : "any";
    }

    const humanSQL = 'NOT "Tags".automatic';
    const AISQL = '"Tags".automatic';
    switch (tagMode) {
      case "any":
        return "";
      case "untagged":
        return Recording.queryBuilder.notTagOfType(tagWhats, null);
      case "tagged":
        return Recording.queryBuilder.tagOfType(tagWhats, null);
      case "human-tagged":
        return Recording.queryBuilder.tagOfType(tagWhats, humanSQL);
      case "automatic-tagged":
        return Recording.queryBuilder.tagOfType(tagWhats, AISQL);
      case "both-tagged":
        return (
          Recording.queryBuilder.tagOfType(tagWhats, humanSQL) +
          " AND " +
          Recording.queryBuilder.tagOfType(tagWhats, AISQL)
        );
      case "no-human":
        return Recording.queryBuilder.notTagOfType(tagWhats, humanSQL);
      case "automatic-only":
        return (
          Recording.queryBuilder.tagOfType(tagWhats, AISQL) +
          " AND " +
          Recording.queryBuilder.notTagOfType(tagWhats, humanSQL)
        );
      case "human-only":
        return (
          Recording.queryBuilder.tagOfType(tagWhats, humanSQL) +
          " AND " +
          Recording.queryBuilder.notTagOfType(tagWhats, AISQL)
        );
      case "automatic+human":
        return (
          Recording.queryBuilder.tagOfType(tagWhats, humanSQL) +
          " AND " +
          Recording.queryBuilder.tagOfType(tagWhats, AISQL)
        );
      case "cool":
      case "missed track":
      case "multiple animals":
      case "trapped in trap": {
        let sqlQuery =
          "(EXISTS (" +
          Recording.queryBuilder.recordingTaggedWith([tagMode], null) +
          "))";
        if (tagWhats) {
          sqlQuery =
            sqlQuery +
            " AND " +
            Recording.queryBuilder.tagOfType(tagWhats, null);
        }
        return sqlQuery;
      }
      default:
        throw `invalid tag mode: ${tagMode}`;
    }
  };

  Recording.queryBuilder.tagOfType = (tagWhats, tagTypeSql) => {
    return (
      "(EXISTS (" +
      Recording.queryBuilder.recordingTaggedWith(tagWhats, tagTypeSql) +
      ") OR EXISTS(" +
      Recording.queryBuilder.trackTaggedWith(tagWhats, tagTypeSql) +
      "))"
    );
  };

  Recording.queryBuilder.notTagOfType = (tagWhats, tagTypeSql) => {
    return (
      "NOT EXISTS (" +
      Recording.queryBuilder.recordingTaggedWith(tagWhats, tagTypeSql) +
      ") AND NOT EXISTS(" +
      Recording.queryBuilder.trackTaggedWith(tagWhats, tagTypeSql) +
      ")"
    );
  };

  Recording.queryBuilder.recordingTaggedWith = (tags, tagTypeSql) => {
    let sql =
      'SELECT "Recording"."id" FROM "Tags" WHERE  "Tags"."RecordingId" = "Recording".id';
    if (tags) {
      sql +=
        " AND (" +
        Recording.queryBuilder.selectByTagWhat(tags, "what", true) +
        ")";
    }
    if (tagTypeSql) {
      sql += " AND (" + tagTypeSql + ")";
    }
    return sql;
  };

  Recording.queryBuilder.trackTaggedWith = (tags, tagTypeSql) => {
    let sql =
      'SELECT "Recording"."id" FROM "Tracks" INNER JOIN "TrackTags" AS "Tags" ON "Tracks"."id" = "Tags"."TrackId" ' +
      'WHERE "Tracks"."RecordingId" = "Recording".id AND "Tracks"."archivedAt" IS NULL';
    if (tags) {
      sql +=
        " AND (" +
        Recording.queryBuilder.selectByTagWhat(tags, "what", false) +
        ")";
    }
    if (tagTypeSql) {
      sql += " AND (" + tagTypeSql + ")";
    }
    return sql;
  };

  Recording.queryBuilder.selectByTagWhat = (tags, whatName, usesDetail) => {
    if (!tags || tags.length === 0) {
      return null;
    }

    const parts = [];
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i];
      if (tag == "interesting") {
        if (usesDetail) {
          parts.push(
            '(("Tags"."' +
              whatName +
              '" IS NULL OR "Tags"."' +
              whatName +
              "\"!='bird') " +
              'AND ("Tags"."detail" IS NULL OR "Tags"."detail"!=\'false positive\'))'
          );
        } else {
          parts.push(
            '("Tags"."' +
              whatName +
              '"!=\'bird\' AND "Tags"."' +
              whatName +
              "\"!='false positive')"
          );
        }
      } else {
        parts.push('"Tags"."' + whatName + "\" = '" + tag + "'");
        if (usesDetail) {
          // the label could also be the detail field not the what field
          parts.push('"Tags"."detail" = \'' + tag + "'");
        }
      }
    }
    return parts.join(" OR ");
  };

  Recording.queryBuilder.prototype.get = function() {
    return this.query;
  };

  Recording.queryBuilder.prototype.addColumn = function(name) {
    this.query.attributes.push(name);
    return this;
  };

  // Include details of recent audio bait events in the query output.
  Recording.queryBuilder.prototype.addAudioEvents = function() {
    const deviceInclude = this.findInclude(models.Device);

    if (!deviceInclude.include) {
      deviceInclude.include = {};
    }
    deviceInclude.include = [
      {
        model: models.Event,
        required: false,
        where: {
          dateTime: {
            [Op.between]: [
              sequelize.literal(
                '"Recording"."recordingDateTime" - interval \'30 minutes\''
              ),
              sequelize.literal('"Recording"."recordingDateTime"')
            ]
          }
        },
        include: [
          {
            model: models.DetailSnapshot,
            as: "EventDetail",
            required: true,
            where: {
              type: "audioBait"
            },
            attributes: ["details"]
          }
        ]
      }
    ];

    return this;
  };

  Recording.queryBuilder.prototype.findInclude = function(modelType) {
    for (const inc of this.query.include) {
      if (inc.model === modelType) {
        return inc;
      }
    }
    throw new `could not find query include for ${modelType}`();
  };

  // Attributes returned in recording query results.
  Recording.queryGetAttributes = [
    "id",
    "type",
    "recordingDateTime",
    "rawMimeType",
    "fileMimeType",
    "processingState",
    "duration",
    "location",
    "batteryLevel",
    "DeviceId",
    "GroupId"
  ];

  // Attributes returned when looking up a single recording.
  Recording.userGetAttributes = [
    "id",
    "rawMimeType",
    "fileMimeType",
    "processingState",
    "duration",
    "recordingDateTime",
    "relativeToDawn",
    "relativeToDusk",
    "location",
    "version",
    "batteryLevel",
    "batteryCharging",
    "airplaneModeOn",
    "type",
    "additionalMetadata",
    "GroupId",
    "fileKey",
    "comment"
  ];

  // Fields that can be provided when uploading new recordings.
  Recording.apiSettableFields = [
    "type",
    "duration",
    "recordingDateTime",
    "relativeToDawn",
    "relativeToDusk",
    "location",
    "version",
    "batteryCharging",
    "batteryLevel",
    "airplaneModeOn",
    "additionalMetadata",
    "processingMeta",
    "comment"
  ];

  // local
  const apiUpdatableFields = ["location", "comment", "additionalMetadata"];

  Recording.processingStates = {
    thermalRaw: ["getMetadata", "toMp4", "FINISHED"],
    audio: ["toMp3", "FINISHED"]
  };

  Recording.processingAttributes = [
    "id",
    "type",
    "jobKey",
    "rawFileKey",
    "rawMimeType",
    "fileKey",
    "fileMimeType",
    "processingState",
    "processingMeta"
  ];
  // local
  const validTagModes = Object.freeze([
    "any",
    "untagged",
    "tagged",
    "human-tagged",
    "automatic-tagged",
    "both-tagged",
    "no-human", // untagged or automatic only
    "automatic-only",
    "human-only",
    "automatic+human",
    "missed track",
    "multiple animals",
    "trapped in trap",
    "cool"
  ]);

  return Recording;
};
