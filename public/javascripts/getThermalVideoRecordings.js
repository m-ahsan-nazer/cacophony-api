function getTableData() {
  return [
    { tableName: "ID", modelField: "id", parseFunction: util.parseNumber },
    { tableName: "Group", modelField: "group", parseFunction: util.parseGroup },
    { tableName: "Device ID", modelField: "deviceId", parseFunction: util.parseNumber },
    { tableName: "Location", modelField: "location", parseFunction: util.parseLocation },
    { tableName: "Time", modelField: "recordingTime", parseFunction: util.parseTimeOnly },
    { tableName: "Date", modelField: "recordingDateTime", parseFunction: util.parseDateOnly },
    { tableName: "Duration", modelField: "duration", parseFunction: util.parseDuration },
    { tableName: "File", modelField: "fileUrl", parseFunction: util.parseUrl }
  ];
}

var apiUrl = "api/v1/thermalVideoRecordings";
var viewUrl = '/view_thermal_video_recording/';
