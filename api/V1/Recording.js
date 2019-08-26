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

const { query, param, body } = require("express-validator/check");
const csv = require("fast-csv");

const middleware = require("../middleware");
const auth = require("../auth");
const models = require("../../models");
const recordingUtil = require("./recordingUtil");
const responseUtil = require("./responseUtil");

module.exports = (app, baseUrl) => {
  const apiUrl = baseUrl + "/recordings";

  /**
   * @apiDefine RecordingParams
   *
   * @apiParam {JSON} data Metadata about the recording.   Valid tags are:
   * <ul>
   * <li>(REQUIRED) type: 'thermalRaw', or 'audio'
   * <li>duration
   * <li>recordingDateTime
   * <li>location
   * <li>version
   * <li>batteryCharging
   * <li>batteryLevel
   * <li>airplaneModeOn
   * <li>additionalMetadata
   * <li>comment
   * </ul>
   * @apiParam {File} file Recording file to upload
   */

  /**
   * @api {post} /api/v1/recordings Add a new recording
   * @apiName PostRecording
   * @apiGroup Recordings
   * @apiDescription Uploads a device's own raw thermal video to the server.  It currently
   * supports raw thermal video but will eventually support all recording types.
   *
   * @apiUse V1DeviceAuthorizationHeader
   *
   * @apiUse RecordingParams
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {Number} recordingId ID of the recording.
   * @apiuse V1ResponseError
   */
  app.post(
    apiUrl,
    [auth.authenticateDevice],
    middleware.requestWrapper(recordingUtil.makeUploadHandler())
  );

  /**
   * @api {post} /api/v1/recordings/device/:devicename/group/:groupname? Add a new recording on behalf of device
   * @apiName PostRecordingOnBehalf
   * @apiGroup Recordings
   * @apiDescription Called by a user to upload raw thermal video on behalf of a device.
   * The user must have permission to view videos from the device or the call will return an
   * error.
   *
   * @apiUse V1UserAuthorizationHeader
   *
   * @apiUse RecordingParams
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {Number} recordingId ID of the recording.
   * @apiuse V1ResponseError
   */

  app.post(
    apiUrl + "/device/:devicename/group/:groupname",
    [
      auth.authenticateUser,
      middleware.setGroupName(param),
      middleware.getDevice(param),
      auth.userCanAccessDevices
    ],
    middleware.requestWrapper(recordingUtil.makeUploadHandler())
  );

  /**
   * @api {post} /api/v1/recordings/device/:devicename Add a new recording on behalf of device
   * @apiName PostRecordingOnBehalf
   * @apiGroup Recordings
   * @apiDescription Called by a user to upload raw thermal video on behalf of a device.
   * The user must have permission to view videos from the device or the call will return an
   * error.
   *
   * @apiParam {String} [devicename] can be name or id of a device
   * @apiUse V1UserAuthorizationHeader
   *
   * @apiUse RecordingParams
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {Number} recordingId ID of the recording.
   * @apiuse V1ResponseError
   */

  app.post(
    apiUrl + "/device/:devicename",
    [
      auth.authenticateUser,
      middleware.getDevice(param),
      auth.userCanAccessDevices
    ],
    middleware.requestWrapper(recordingUtil.makeUploadHandler())
  );

  const queryValidators = Object.freeze([
    middleware.parseJSON("where", query).optional(),
    query("offset")
      .isInt()
      .optional(),
    query("limit")
      .isInt()
      .optional(),
    middleware.parseJSON("order", query).optional(),
    middleware.parseArray("tags", query).optional(),
    query("tagMode")
      .optional()
      .custom(value => {
        return models.Recording.isValidTagMode(value);
      }),
    middleware.parseJSON("filterOptions", query).optional()
  ]);

  /**
   * @api {get} /api/v1/recordings Query available recordings
   * @apiName QueryRecordings
   * @apiGroup Recordings
   *
   * @apiUse V1UserAuthorizationHeader
   * @apiUse BaseQueryParams
   * @apiUse MoreQueryParams
   * @apiUse FilterOptions
   * @apiUse V1ResponseSuccessQuery
   * @apiUse V1ResponseError
   */
  app.get(
    apiUrl,
    [auth.authenticateUser].concat(queryValidators),
    middleware.requestWrapper(async (request, response) => {
      const result = await recordingUtil.query(request);
      responseUtil.send(response, {
        statusCode: 200,
        messages: ["Completed query."],
        limit: request.query.limit,
        offset: request.query.offset,
        count: result.count,
        rows: result.rows
      });
    })
  );

  /**
   * @api {get} /api/v1/recordings/report Generate report for a set of recordings
   * @apiName Report
   * @apiGroup Recordings
   * @apiDescription Parameters are as per GET /api/V1/recordings. On
   * success (status 200), the response body will contain CSV
   * formatted details of the selected recordings.
   *
   * @apiUse V1UserAuthorizationHeader
   * @apiParam {String} [jwt] Signed JWT as produced by the [Token](#api-Authentication-Token) endpoint
   * @apiUse BaseQueryParams
   * @apiUse MoreQueryParams
   * @apiUse FilterOptions
   * @apiUse V1ResponseError
   */
  app.get(
    apiUrl + "/report",
    [auth.paramOrHeader].concat(queryValidators),
    middleware.requestWrapper(async (request, response) => {
      const rows = await recordingUtil.report(request);
      response.status(200).set({
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=recordings.csv"
      });
      csv.writeToStream(response, rows);
    })
  );

  /**
   * @api {get} /api/v1/recordings/:id Get a recording
   * @apiName GetRecording
   * @apiGroup Recordings
   *
   * @apiUse MetaDataAndJWT
   * @apiUse V1UserAuthorizationHeader
   *
   * @apiUse FilterOptions
   * @apiUse V1ResponseSuccess
   * @apiSuccess {int} fileSize the number of bytes in recording file.
   * @apiSuccess {int} rawSize the number of bytes in raw recording file.
   * @apiSuccess {String} downloadFileJWT JSON Web Token to use to download the
   * recording file.
   * @apiSuccess {String} downloadRawJWT JSON Web Token to use to download
   * the raw recording data.
   * @apiSuccess {JSON} recording The recording data.
   *
   * @apiUse V1ResponseError
   */
  app.get(
    apiUrl + "/:id",
    [
      auth.authenticateUser,
      param("id").isInt(),
      middleware.parseJSON("filterOptions", query).optional()
    ],
    middleware.requestWrapper(async (request, response) => {
      const {
        recording,
        rawSize,
        rawJWT,
        cookedSize,
        cookedJWT
      } = await recordingUtil.get(request);

      responseUtil.send(response, {
        statusCode: 200,
        messages: [],
        recording: recording,
        rawSize: rawSize,
        fileSize: cookedSize,
        downloadFileJWT: cookedJWT,
        downloadRawJWT: rawJWT
      });
    })
  );

  /**
   * @api {delete} /api/v1/recordings/:id Delete an existing recording
   * @apiName DeleteRecording
   * @apiGroup Recordings
   *
   * @apiUse V1UserAuthorizationHeader
   *
   * @apiUse V1ResponseSuccess
   * @apiUse V1ResponseError
   */
  app.delete(
    apiUrl + "/:id",
    [auth.authenticateUser, param("id").isInt()],
    middleware.requestWrapper(async (request, response) => {
      return recordingUtil.delete_(request, response);
    })
  );

  /**
   * @api {patch} /api/v1/recordings/:id Update an existing recording
   * @apiName UpdateRecording
   * @apiGroup Recordings
   * @apiDescription This call is used for updating fields of a previously
   * submitted recording.
   *
   * The following fields that may be updated are:
   * - location
   * - comment
   * - additionalMetadata
   *
   * If a change to any other field is attempted the request will fail and no
   * update will occur.
   *
   * @apiUse V1UserAuthorizationHeader
   *
   * @apiParam {JSON} updates Object containing the fields to update and their new values.
   *
   * @apiUse V1ResponseSuccess
   * @apiUse V1ResponseError
   */
  app.patch(
    apiUrl + "/:id",
    [
      auth.authenticateUser,
      param("id").isInt(),
      middleware.parseJSON("updates", body)
    ],
    middleware.requestWrapper(async (request, response) => {
      const updated = await models.Recording.updateOne(
        request.user,
        request.params.id,
        request.body.updates
      );

      if (updated) {
        return responseUtil.send(response, {
          statusCode: 200,
          messages: ["Updated recording."]
        });
      } else {
        return responseUtil.send(response, {
          statusCode: 400,
          messages: ["Failed to update recordings."]
        });
      }
    })
  );

  /**
   * @api {post} /api/v1/recordings/:id/tracks Add new track to recording
   * @apiName PostTrack
   * @apiGroup Tracks
   *
   * @apiUse V1UserAuthorizationHeader
   *
   * @apiParam {number} id Id of the recording to add the track to.
   * @apiParam {JSON} data Data which defines the track (type specific).
   * @apiParam {JSON} algorithm (Optional) Description of algorithm that generated track
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {int} trackId Unique id of the newly created track.
   *
   * @apiUse V1ResponseError
   *
   */
  app.post(
    apiUrl + "/:id/tracks",
    [
      auth.authenticateUser,
      param("id")
        .isInt()
        .toInt(),
      middleware.parseJSON("data", body),
      middleware.parseJSON("algorithm", body).optional()
    ],
    middleware.requestWrapper(async (request, response) => {
      const recording = await models.Recording.get(
        request.user,
        request.params.id,
        models.Recording.Perms.UPDATE
      );
      if (!recording) {
        responseUtil.send(response, {
          statusCode: 400,
          messages: ["No such recording."]
        });
        return;
      }

      const algorithm = request.body.algorithm
        ? request.body.algorithm
        : "{'status': 'User added.'";
      const algorithmDetail = await models.DetailSnapshot.getOrCreateMatching(
        "algorithm",
        algorithm
      );

      const track = await recording.createTrack({
        data: request.body.data,
        AlgorithmId: algorithmDetail.id
      });
      responseUtil.send(response, {
        statusCode: 200,
        messages: ["Track added."],
        trackId: track.id
      });
    })
  );

  /**
   * @api {get} /api/v1/recordings/:id/tracks Get tracks for recording
   * @apiName GetTracks
   * @apiGroup Tracks
   * @apiDescription Get all tracks for a given recording and their tags.
   *
   * @apiUse V1UserAuthorizationHeader
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {JSON} tracks Array with elements containing id,
   * algorithm, data and tags fields.
   *
   * @apiUse V1ResponseError
   */
  app.get(
    apiUrl + "/:id/tracks",
    [auth.authenticateUser, param("id").isInt()],
    middleware.requestWrapper(async (request, response) => {
      const recording = await models.Recording.get(
        request.user,
        request.params.id,
        models.Recording.Perms.VIEW
      );
      if (!recording) {
        responseUtil.send(response, {
          statusCode: 400,
          messages: ["No such recording."]
        });
        return;
      }

      const tracks = await recording.getActiveTracksTagsAndTagger();
      responseUtil.send(response, {
        statusCode: 200,
        messages: ["OK."],
        tracks: tracks.map(t => {
          delete t.dataValues.RecordingId;
          return t;
        })
      });
    })
  );

  /**
   * @api {delete} /api/v1/recordings/:id/tracks/:trackId Remove track from recording
   * @apiName DeleteTrack
   * @apiGroup Tracks
   *
   * @apiUse V1UserAuthorizationHeader
   * @apiUse V1ResponseSuccess
   * @apiUse V1ResponseError
   *
   */
  app.delete(
    apiUrl + "/:id/tracks/:trackId",
    [
      auth.authenticateUser,
      param("id")
        .isInt()
        .toInt(),
      param("trackId")
        .isInt()
        .toInt()
    ],
    middleware.requestWrapper(async (request, response) => {
      const track = await loadTrack(request, response);
      if (!track) {
        return;
      }
      await track.destroy();
      responseUtil.send(response, {
        statusCode: 200,
        messages: ["Track deleted."]
      });
    })
  );

  /**
   * @api {post} /api/v1/recordings/:id/tracks/:trackId/tags Add tag to track
   * @apiName PostTrackTag
   * @apiGroup Tracks
   *
   * @apiUse V1UserAuthorizationHeader
   *
   * @apiParam {String} what Object/event to tag.
   * @apiParam {Number} confidence Tag confidence score.
   * @apiParam {Boolean} automatic "true" if tag is machine generated, "false" otherwise.
   * @apiParam {JSON} data Data Additional tag data.
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {int} trackTagId Unique id of the newly created track tag.
   *
   * @apiUse V1ResponseError
   *
   */
  app.post(
    apiUrl + "/:id/tracks/:trackId/tags",
    [
      auth.authenticateUser,
      param("id")
        .isInt()
        .toInt(),
      param("trackId")
        .isInt()
        .toInt(),
      body("what"),
      body("confidence")
        .isFloat()
        .toFloat(),
      body("automatic")
        .isBoolean()
        .toBoolean(),
      middleware.parseJSON("data", body).optional()
    ],
    middleware.requestWrapper(async (request, response) => {
      const track = await loadTrack(request, response);
      if (!track) {
        return;
      }

      const tag = await track.createTrackTag({
        what: request.body.what,
        confidence: request.body.confidence,
        automatic: request.body.automatic,
        data: request.body.data,
        UserId: request.user.id
      });
      responseUtil.send(response, {
        statusCode: 200,
        messages: ["Track tag added."],
        trackTagId: tag.id
      });
    })
  );

  /**
   * @api {delete} /api/v1/recordings/:id/tracks/:trackId/tags/:trackTagId Delete a track tag
   * @apiName DeleteTrackTag
   * @apiGroup Tracks
   *
   * @apiUse V1UserAuthorizationHeader
   *
   * @apiUse V1ResponseSuccess
   * @apiUse V1ResponseError
   */
  app.delete(
    apiUrl + "/:id/tracks/:trackId/tags/:trackTagId",
    [
      auth.authenticateUser,
      param("id")
        .isInt()
        .toInt(),
      param("trackId")
        .isInt()
        .toInt(),
      param("trackTagId")
        .isInt()
        .toInt()
    ],
    middleware.requestWrapper(async (request, response) => {
      const track = await loadTrack(request, response);
      if (!track) {
        return;
      }

      const tag = await track.getTrackTag(request.params.trackTagId);
      if (!tag) {
        responseUtil.send(response, {
          statusCode: 400,
          messages: ["No such track tag."]
        });
        return;
      }

      await tag.destroy();

      responseUtil.send(response, {
        statusCode: 200,
        messages: ["Track tag deleted."]
      });
    })
  );

  async function loadTrack(request, response) {
    const recording = await models.Recording.get(
      request.user,
      request.params.id,
      models.Recording.Perms.UPDATE
    );
    if (!recording) {
      responseUtil.send(response, {
        statusCode: 400,
        messages: ["No such recording."]
      });
      return;
    }

    const track = await recording.getTrack(request.params.trackId);
    if (!track) {
      responseUtil.send(response, {
        statusCode: 400,
        messages: ["No such track."]
      });
      return;
    }

    return track;
  }
};
