define({ "api": [
  {
    "type": "get",
    "url": "/api/v1/audioRecordings/:id",
    "title": "Get AudioRecording",
    "name": "GetAudioRecording",
    "group": "AudioRecording",
    "version": "1.0.0",
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID of the AudioRecording.</p>"
          }
        ]
      }
    },
    "success": {
      "examples": [
        {
          "title": "Success-Response:",
          "content": "    HTTP 200\n   {\n\t\t\t\"audioRecording\"\n\t\t\t  {\n\t\t\t\t\t//AudioRecording metadata.\n\t\t\t\t}\n   }",
          "type": "json"
        }
      ]
    },
    "error": {
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP 200\n{\n  \"error\": [Error message]\n}",
          "type": "json"
        }
      ]
    },
    "filename": "router/apiv1.js",
    "groupTitle": "AudioRecording"
  },
  {
    "type": "post",
    "url": "/api/v1/audioRecordings",
    "title": "Add AudioRecording",
    "name": "PostAudioRecording",
    "group": "AudioRecording",
    "version": "1.0.0",
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "JSON",
            "optional": false,
            "field": "data",
            "description": "<p>Metadata for the AudioRecording.</p>"
          },
          {
            "group": "Parameter",
            "type": "File",
            "optional": false,
            "field": "recording",
            "description": "<p>The audio file.</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Data-Example:",
          "content": "{\n\t\"audioFile\": { \"startTimestamp\": \"2016-01-1 12:30:20.123+1300\", \"duration\": 120},\n\t\"device\": { \"id\": 123, \"type\": \"cacophonometer1.0\"},\n\t\"recordingRule\": { \"id\": 123, \"name\": \"RuleName\", \"duration\": 120},\n\t\"location\": { \"id\": 123, \"latitude\": 123123123, \"longitude\": 321321321, \"timestamp\": \"2016-01-1 12:30:20.123+1300\", \"accuracy\": 40},\n\t\"hardware\": { \"id\": 123, \"manufacturer\": \"CacoMan\", \"model\": \"M-Two\", \"solarPanelPower\": 6000},\n\t\"software\": { \"id\": 123, \"version\": 0.1.2},\n\t\"microphone\": { \"id\": 123, \"type\": \"electret\" },\n\t\"environment\": { \"id\": 123, \"tempreature\": 21},\n\t\"batteryPercentage\": 48,\n\t\"tags\": {},\n\t\"extra\": {}\n}",
          "type": "json"
        }
      ]
    },
    "success": {
      "examples": [
        {
          "title": "Success-Response:",
          "content": " HTTP 200\n{\n  \"Message\": \"Successful AudioRecording Post.\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP 200\n{\n  \"error\": [Error message]\n}",
          "type": "json"
        }
      ]
    },
    "filename": "router/apiv1.js",
    "groupTitle": "AudioRecording"
  },
  {
    "type": "post",
    "url": "/api/v1/videoRecordings",
    "title": "Add VideoRecording",
    "name": "PostVideoRecording",
    "group": "VideoRecording",
    "version": "1.0.0",
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "JSON",
            "optional": false,
            "field": "data",
            "description": "<p>Metadata for the VideoRecording.</p>"
          },
          {
            "group": "Parameter",
            "type": "File",
            "optional": false,
            "field": "recording",
            "description": "<p>The audio file.</p>"
          }
        ]
      }
    },
    "filename": "router/apiv1.js",
    "groupTitle": "VideoRecording"
  }
] });
