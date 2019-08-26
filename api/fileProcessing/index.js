const { body, param } = require("express-validator/check");

const log = require("../../logging");
const middleware = require("../middleware");
const models = require("../../models");
const recordingUtil = require("../V1/recordingUtil");
const responseUtil = require("../V1/responseUtil");

module.exports = function(app) {
  const apiUrl = "/api/fileProcessing";

  /**
   * @api {get} /api/fileProcessing Get a new file processing job
   * @apiName getNewFileProcessingJob
   * @apiGroup FileProcessing
   *
   * @apiParam {String} type Type of recording.
   * @apiParam {String} state Processing state.
   */
  app.get(apiUrl, async (request, response) => {
    log.info(request.method + " Request: " + request.url);
    const type = request.query.type;
    const state = request.query.state;
    const recording = await models.Recording.getOneForProcessing(type, state);
    if (recording == null) {
      log.debug("No file to be processed.");
      return response.status(204).json();
    } else {
      return response.status(200).json({
        recording: recording.dataValues
      });
    }
  });

  /**
   * @api {put} /api/fileProcessing Finished a file processing job
   * @apiName finishedFileProcessingJob
   * @apiGroup FileProcessing
   *
   * @apiParam {Integer} id ID of the recording.
   * @apiParam {String} jobKey Key given when reqesting the job.
   * @apiParam {Boolean} success If the job was finished successfully.
   * @apiParam {JSON} [result] Result of the file processing
   * @apiParam {Boolean} complete true if the processing is complete, or false if file will be processed further.
   * @apiParam {String} [newProcessedFileKey] LeoFS Key of the new file.
   */
  app.put(apiUrl, async (request, response) => {
    const id = parseInt(request.body.id);
    const jobKey = request.body.jobKey;
    const success = middleware.parseBool(request.body.success);
    let result = request.body.result;
    const complete = middleware.parseBool(request.body.complete);
    const newProcessedFileKey = request.body.newProcessedFileKey;

    // Validate request.
    const errorMessages = [];
    if (isNaN(id)) {
      errorMessages.push("'id' field needs to be a number.");
    }
    if (jobKey == null) {
      errorMessages.push("'jobKey' field is required.");
    }
    if (success == null) {
      errorMessages.push("'success' field is required");
    }
    if (result != null) {
      try {
        result = JSON.parse(result);
      } catch (e) {
        errorMessages.push("'result' field was not a valid JSON.");
      }
    }

    if (errorMessages.length > 0) {
      return response.status(400).json({
        messages: errorMessages
      });
    }

    const recording = await models.Recording.findOne({ where: { id: id } });

    // Check that jobKey is correct.
    if (jobKey != recording.get("jobKey")) {
      return response.status(400).json({
        messages: ["'jobKey' given did not match the database.."]
      });
    }

    if (success) {
      const jobs = models.Recording.processingStates[recording.type];
      const nextJob = jobs[jobs.indexOf(recording.processingState) + 1];
      recording.set("processingState", nextJob);
      recording.set("fileKey", newProcessedFileKey);
      log.info("Complete is " + complete);
      if (complete) {
        recording.set("jobKey", null);
        recording.set("processingStartTime", null);
      }

      // Process extra data from file processing
      if (result && result.fieldUpdates) {
        recording.mergeUpdate(result.fieldUpdates);
      }

      await recording.save();
      return response.status(200).json({ messages: ["Processing finished."] });
    } else {
      recording.set("processingStartTime", null);
      recording.set("jobKey", null);
      await recording.save();
      return response.status(200).json({
        messages: ["Processing failed."]
      });
    }
  });

  /**
   * @api {post} /api/fileProcessing/tags Add a tag to a recording
   * @apiName tagRecordingAfterFileProcessing
   * @apiGroup FileProcessing
   *
   * @apiDescription This call takes a `tag` field which contains a JSON
   * object string containing a number of fields. See /api/V1/tags for
   * more details.
   *
   * @apiParam {Number} recordingId ID of the recording that you want to tag.
   * @apiparam {JSON} tag Tag data in JSON format.
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {Number} tagId ID of the tag just added.
   *
   * @apiuse V1ResponseError
   *
   */
  app.post(
    apiUrl + "/tags",
    [middleware.parseJSON("tag", body), body("recordingId").isInt()],
    middleware.requestWrapper(async (request, response) => {
      const options = {
        include: [
          { model: models.Device, where: {}, attributes: ["devicename", "id"] }
        ]
      };
      const recording = await models.Recording.findByPk(
        request.body.recordingId,
        options
      );
      recordingUtil.addTag(null, recording, request.body.tag, response);
    })
  );

  /**
   * @api {post} /api/fileProcessing/metadata Updates the metadata for the recording
   * @apiName updateMetaData
   * @apiGroup FileProcessing
   *
   * @apiDescription This call updates the metadata for a recording
   *
   * @apiParam {Number} recordingId ID of the recording that you want to tag.
   * @apiparam {JSON} metadata Metadata to be updated for the recording.  See /api/V1/recording for more details
   *
   * @apiUse V1ResponseSuccess
   *
   * @apiuse V1ResponseError
   *
   */
  app.post(
    apiUrl + "/metadata",
    [middleware.getRecordingById(body), middleware.parseJSON("metadata", body)],
    middleware.requestWrapper(async request => {
      recordingUtil.updateMetadata(
        request.body.recording,
        request.body.metadata
      );
    })
  );

  /**
   * @api {post} /api/fileProcessing/:id/tracks Add track to recording
   * @apiName PostTrack
   * @apiGroup FileProcessing
   *
   * @apiParam {JSON} data Data which defines the track (type specific).
   * @apiParam {Number} AlgorithmId Database Id of the Tracking algorithm details retrieved from
   * (#FileProcessing:Algorithm) request
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {int} trackId Unique id of the newly created track.
   *
   * @apiuse V1ResponseError
   *
   */
  app.post(
    apiUrl + "/:id/tracks",
    [
      param("id")
        .isInt()
        .toInt(),
      middleware.parseJSON("data", body),
      middleware.getDetailSnapshotById(body, "algorithmId")
    ],
    middleware.requestWrapper(async (request, response) => {
      const recording = await models.Recording.findByPk(request.params.id);
      if (!recording) {
        responseUtil.send(response, {
          statusCode: 400,
          messages: ["No such recording."]
        });
        return;
      }
      const track = await recording.createTrack({
        data: request.body.data,
        AlgorithmId: request.body.algorithmId
      });
      responseUtil.send(response, {
        statusCode: 200,
        messages: ["Track added."],
        trackId: track.id
      });
    })
  );

  /**
   * @api {delete} /api/fileProcessing/:id/tracks Delete all tracks for a recording
   * @apiName DeleteTracks
   * @apiGroup FileProcessing
   *
   * @apiUse V1ResponseSuccess
   *
   * @apiuse V1ResponseError
   *
   */
  app.delete(
    apiUrl + "/:id/tracks",
    [
      param("id")
        .isInt()
        .toInt()
    ],
    middleware.requestWrapper(async (request, response) => {
      const recording = await models.Recording.findByPk(request.params.id);
      if (!recording) {
        responseUtil.send(response, {
          statusCode: 400,
          messages: ["No such recording."]
        });
        return;
      }

      const tracks = await recording.getTracks();
      tracks.forEach(track => track.destroy());

      responseUtil.send(response, {
        statusCode: 200,
        messages: ["Tracks cleared."]
      });
    })
  );

  /**
   * @api {post} /api/v1/recordings/:id/tracks/:trackId/tags Add tag to track
   * @apiName PostTrackTag
   * @apiGroup FileProcessing
   *
   * @apiParam {String} what Object/event to tag.
   * @apiParam {Number} confidence Tag confidence score.
   * @apiParam {JSON} data Data Additional tag data.
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {int} trackTagId Unique id of the newly created track tag.
   *
   * @apiUse V1ResponseError
   */
  app.post(
    apiUrl + "/:id/tracks/:trackId/tags",
    [
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
      middleware.parseJSON("data", body).optional()
    ],
    middleware.requestWrapper(async (request, response) => {
      const recording = await models.Recording.findByPk(request.params.id);
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

      const tag = await track.createTrackTag({
        what: request.body.what,
        confidence: request.body.confidence,
        automatic: true,
        data: request.body.data
      });
      responseUtil.send(response, {
        statusCode: 200,
        messages: ["Track tag added."],
        trackTagId: tag.id
      });
    })
  );

  /**
   * @api {post} /algorithm Finds matching existing algorithm definition or adds a new one to the database
   * @apiName Algorithm
   * @apiGroup FileProcessing
   *
   * @apiParam {JSON} algorithm algorithm data in tag form.
   *
   * @apiUse V1ResponseSuccess
   * @apiSuccess {int} algorithmId Id of the matching algorithm tag.
   *
   * @apiUse V1ResponseError
   */
  app.post(
    apiUrl + "/algorithm",
    [middleware.parseJSON("algorithm", body)],
    middleware.requestWrapper(async (request, response) => {
      const algorithm = await models.DetailSnapshot.getOrCreateMatching(
        "algorithm",
        request.body.algorithm
      );

      responseUtil.send(response, {
        statusCode: 200,
        messages: ["Algorithm key retrieved."],
        algorithmId: algorithm.id
      });
    })
  );
};
