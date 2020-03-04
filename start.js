/////////////////////////////////////////////////////////////////////
// Copyright (c) Autodesk, Inc. All rights reserved
//
// Permission to use, copy, modify, and distribute this software in
// object code form for any purpose and without fee is hereby granted,
// provided that the above copyright notice appears in all copies and
// that both that copyright notice and the limited warranty and
// restricted rights notice below appear in all supporting
// documentation.
//
// AUTODESK PROVIDES THIS PROGRAM "AS IS" AND WITH ALL FAULTS.
// AUTODESK SPECIFICALLY DISCLAIMS ANY IMPLIED WARRANTY OF
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR USE.  AUTODESK, INC.
// DOES NOT WARRANT THAT THE OPERATION OF THE PROGRAM WILL BE
// UNINTERRUPTED OR ERROR FREE.
/////////////////////////////////////////////////////////////////////

//-------------------------------------------------------------------
// These packages are included in package.json.
// Run `npm install` to install them.
// 'path' is part of Node.js and thus not inside package.json.
//-------------------------------------------------------------------
var express = require('express');           // For web server
var Axios = require('axios');               // A Promised base http client
var bodyParser = require('body-parser');    // Receive JSON format

// Set up Express web server
var app = express();
app.use(bodyParser.json());
app.use(express.static(__dirname + '/www'));

// This is for web server to start listening to port 3000
app.set('port', 3000);
var server = app.listen(app.get('port'), function () {
    console.log('Server listening on port ' + server.address().port);
});

//-------------------------------------------------------------------
// Configuration for your Forge account
// Initialize the 2-legged OAuth2 client, and
// set specific scopes
//-------------------------------------------------------------------
var FORGE_CLIENT_ID = process.env.FORGE_CLIENT_ID;
var FORGE_CLIENT_SECRET = process.env.FORGE_CLIENT_SECRET;
var access_token = '';
var scopes = 'data:read data:write data:create bucket:create bucket:read';
const querystring = require('querystring');

// // Route /api/forge/oauth
app.get('/api/forge/oauth', function (req, res) {
    Axios({
        method: 'POST',
        url: 'https://developer.api.autodesk.com/authentication/v1/authenticate',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
        },
        data: querystring.stringify({
            client_id: FORGE_CLIENT_ID,
            client_secret: FORGE_CLIENT_SECRET,
            grant_type: 'client_credentials',
            scope: scopes
        })
    })
        .then(function (response) {
            // Success
            access_token = response.data.access_token;
            console.log(response);
            res.redirect('/api/forge/datamanagement/bucket/create');
        })
        .catch(function (error) {
            // Failed
            console.log(error);
            res.send('Failed to authenticate');
        });
});

// Route /api/forge/oauth/public
app.get('/api/forge/oauth/public', function (req, res) {
    // Limit public token to Viewer read only
    Axios({
        method: 'POST',
        url: 'https://developer.api.autodesk.com/authentication/v1/authenticate',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
        },
        data: querystring.stringify({
            client_id: FORGE_CLIENT_ID,
            client_secret: FORGE_CLIENT_SECRET,
            grant_type: 'client_credentials',
            scope: 'viewables:read'
        })
    })
        .then(function (response) {
            // Success
            console.log(response);
            res.json({ access_token: response.data.access_token, expires_in: response.data.expires_in });
        })
        .catch(function (error) {
            // Failed
            console.log(error);
            res.status(500).json(error);
        });
});

// Buckey key and Policy Key for OSS
const bucketKey = FORGE_CLIENT_ID.toLowerCase() + '_tutorial_bucket'; // Prefix with your ID so the bucket key is unique across all buckets on all other accounts
const policyKey = 'transient'; // Expires in 24hr

// Route /api/forge/datamanagement/bucket/create
app.get('/api/forge/datamanagement/bucket/create', function (req, res) {
    // Create an application shared bucket using access token from previous route
    // We will use this bucket for storing all files in this tutorial
    Axios({
        method: 'POST',
        url: 'https://developer.api.autodesk.com/oss/v2/buckets',
        headers: {
            'content-type': 'application/json',
            Authorization: 'Bearer ' + access_token
        },
        data: JSON.stringify({
            'bucketKey': bucketKey,
            'policyKey': policyKey
        })
    })
        .then(function (response) {
            // Success
            console.log(response);
            res.redirect('/api/forge/datamanagement/bucket/detail');
        })
        .catch(function (error) {
            if (error.response && error.response.status == 409) {
                console.log('Bucket already exists, skip creation.');
                res.redirect('/api/forge/datamanagement/bucket/detail');
            }
            // Failed
            console.log(error);
            res.send('Failed to create a new bucket');
        });
});

// Route /api/forge/datamanagement/bucket/detail
app.get('/api/forge/datamanagement/bucket/detail', function (req, res) {
    Axios({
        method: 'GET',
        url: 'https://developer.api.autodesk.com/oss/v2/buckets/' + encodeURIComponent(bucketKey) + '/details',
        headers: {
            Authorization: 'Bearer ' + access_token
        }
    })
        .then(function (response) {
            // Success
            console.log(response);
            res.redirect('/upload.html');
        })
        .catch(function (error) {
            // Failed
            console.log(error);
            res.send('Failed to verify the new bucket');
        });
});

// For converting the source into a Base64-Encoded string
var Buffer = require('buffer').Buffer;
String.prototype.toBase64 = function () {
    // Buffer is part of Node.js to enable interaction with octet streams in TCP streams, 
    // file system operations, and other contexts.
    return new Buffer(this).toString('base64');
};

var multer = require('multer');         // To handle file upload
var upload = multer({ dest: 'tmp/' }); // Save file into local /tmp folder

// Route /api/forge/datamanagement/bucket/upload
app.post('/api/forge/datamanagement/bucket/upload', upload.single('fileToUpload'), function (req, res) {
    var fs = require('fs'); // Node.js File system for reading files
    fs.readFile(req.file.path, function (err, filecontent) {
        // For production use Autodesk recommends that under 100MB files are uploaded without chunking.
        // For testing purposes we will use a limit of 10MB.
        // https://forge.autodesk.com/en/docs/data/v2/reference/http/buckets-:bucketKey-objects-:objectName-resumable-PUT/
        const SMALL_FILE_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;

        const uploadFunction = (filecontent.length > SMALL_FILE_SIZE_LIMIT_BYTES ? uploadFileBig : uploadFileSmall);

        uploadFunction.call(null, req.file.originalname, filecontent)
            .then(function (response) {
                // Success
                console.log(response);
                var urn = response.data.objectId.toBase64();
                res.redirect('/api/forge/modelderivative/' + urn);
            })
            .catch(function (error) {
                // Failed
                console.log(error);
                res.send('Failed to create a new object in the bucket');
            });
    });
});

// Route /api/forge/modelderivative
app.get('/api/forge/modelderivative/:urn', function (req, res) {
    var urn = req.params.urn;
    var format_type = 'svf';
    var format_views = ['2d', '3d'];
    Axios({
        method: 'POST',
        url: 'https://developer.api.autodesk.com/modelderivative/v2/designdata/job',
        headers: {
            'content-type': 'application/json',
            Authorization: 'Bearer ' + access_token
        },
        data: JSON.stringify({
            'input': {
                'urn': urn
            },
            'output': {
                'formats': [
                    {
                        'type': format_type,
                        'views': format_views
                    }
                ]
            }
        })
    })
        .then(function (response) {
            // Success
            console.log(response);
            res.redirect('/viewer.html?urn=' + urn);
        })
        .catch(function (error) {
            // Failed
            console.log(error);
            res.send('Error at Model Derivative job.');
        });
});

const uploadFileSmall = function (originalFileName, dataBuffer) {
    return Axios({
        method: 'PUT',
        url: 'https://developer.api.autodesk.com/oss/v2/buckets/' + encodeURIComponent(bucketKey) + '/objects/' + encodeURIComponent(originalFileName),
        headers: {
            Authorization: 'Bearer ' + access_token,
            'Content-Disposition': originalFileName,
            'Content-Length': dataBuffer.length
        },
        data: dataBuffer
    });
};

const uploadFileBig = function (originalFileName, dataBuffer) {
    // Autodesk recommends 5MB chunks
    // https://forge.autodesk.com/en/docs/data/v2/reference/http/buckets-:bucketKey-objects-:objectName-resumable-PUT/
    const UPLOAD_CHUNK_BYTES = (5 * 1024 * 1024);

    const sessionId = (new Date()).getTime();
    const fullContentLengthBytes = dataBuffer.length;
    var chunks = [];

    while (chunks.length * UPLOAD_CHUNK_BYTES < dataBuffer.length) {
        var newChunkStartByte = (chunks.length * UPLOAD_CHUNK_BYTES);
        var bytesLeftInBuffer = (dataBuffer.length - newChunkStartByte);
        var newChunkEndByte = (bytesLeftInBuffer > UPLOAD_CHUNK_BYTES ? newChunkStartByte + UPLOAD_CHUNK_BYTES : dataBuffer.length);

        console.log('%s CHUNK CREATED %d-%d/%d', sessionId, newChunkStartByte, newChunkEndByte, fullContentLengthBytes);
        chunks.push(dataBuffer.slice(newChunkStartByte, newChunkEndByte));
    }

    return chunks.reduce(function (prev, chunkData, index) {
            const chunkStartByte = index * UPLOAD_CHUNK_BYTES;
            const chunkEndByte = chunkStartByte + chunkData.length;
            return prev.then(function () {
                return uploadFileChunk(sessionId, originalFileName, fullContentLengthBytes, chunkStartByte, chunkEndByte, chunkData);
            });
        }, Promise.resolve())
        .then(function(response) {
            console.log('%s CHUNKS UPLOADED', sessionId, response.data);
            return response;
        })
};

const uploadFileChunk = function (sessionId, originalFileName, fullContentLengthBytes, chunkStartByte, chunkEndByte, chunkData) {
    const lastByte = chunkEndByte - 1;
    console.log('%s UPLOADING CHUNK %d bytes from %d to %d of %d..', sessionId, chunkData.length, chunkStartByte, lastByte, fullContentLengthBytes);
    return Axios({
            method: 'PUT',
            url: 'https://developer.api.autodesk.com/oss/v2/buckets/' + encodeURIComponent(bucketKey) + '/objects/' + encodeURIComponent(originalFileName) + '/resumable',
            headers: {
                Authorization: 'Bearer ' + access_token,
                'Content-Type': 'text/plain; charset=UTF-8',
                'Content-Disposition': originalFileName,
                'Content-Range': 'bytes ' + chunkStartByte+'-'+lastByte+'/'+fullContentLengthBytes,
                'Session-Id': sessionId,
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            data: chunkData,
        })
        .then(function (response) {
          console.log('%s UPLOADING CHUNK %d bytes from %d to %d of %d.. DONE', sessionId, chunkData.length, chunkStartByte, lastByte, fullContentLengthBytes);
          return response;
        })
        .catch(function (err) {
          console.error('%s UPLOADING CHUNK %d bytes from %d to %d of %d.. FAILED', sessionId, chunkData.length, chunkStartByte, lastByte, fullContentLengthBytes, err);
          throw err;
        })
};
