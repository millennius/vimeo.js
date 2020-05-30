"use strict";

import Axios from "axios";
import qsModule from "querystring";
import fs from "fs";
import path from "path";
import tus from "tus-js-client";

import { VIMEO_HOSTNAME, AUTH_ENDPOINTS } from "./constants";

/**
 * This object is used to interface with the Vimeo API.
 *
 * @param {string} clientId     OAuth 2 Client Identifier
 * @param {string} clientSecret OAuth 2 Client Secret
 * @param {string} accessToken  OAuth 2 Optional pre-authorized access token
 */
class Vimeo {
  constructor(clientId, clientSecret, accessToken) {
    this._clientId = clientId;
    this._clientSecret = clientSecret;

    if (accessToken) {
      this._accessToken = accessToken;
    }

    this._requestOptions = {
      method: "GET",
      headers: {
        Accept: "application/vnd.vimeo.*+json;version=3.4",
        "User-Agent": "Vimeo.js/2.1.1",
      },
    };
  }

  /**
   * Set a user access token to be used with library requests.
   *
   * @param {string} accessToken
   */
  setAccessToken = (accessToken) => {
    this._accessToken = accessToken;
  };

  /**
   * Exchange a code for an access token. This code should exist on your `redirectUri`.
   *
   * @param {string}   code         The code provided on your `redirectUri`.
   * @param {string}   redirectUri  The exact `redirectUri` provided to `buildAuthorizationEndpoint`
   *                                and configured in your API app settings.
   */
  accessToken = async (code, redirectUri) => {
    const url = `https://${VIMEO_HOSTNAME}/${AUTH_ENDPOINTS.accessToken}`;
    const body = {
      grant_type: "authorization_code",
      code: code,
      redirect_uri: redirectUri,
    };
    const config = {
      headers: {
        ...this._requestOptions.headers,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    };

    try {
      const response = await Axios.post(url, body, config);
      return response.data;
    } catch (error) {
      throw error;
    }
  };

  /**
   * The first step of the authorization process.
   *
   * This function returns a URL, which the user should be sent to (via redirect or link).
   *
   * The destination allows the user to accept or deny connecting with vimeo, and accept or deny each
   * of the scopes you requested. Scopes are passed through the second parameter as an array of
   * strings, or a space delimited list.
   *
   * Once accepted or denied, the user is redirected back to the `redirectUri`.
   *
   * @param  {string} redirectUri   The URI that will exchange a code for an access token. Must match
   *                                the URI in your API app settings.
   * @param  {string|string[]} scope  An array of scopes. See https://developer.vimeo.com/api/authentication#scopes
   *                                for more.
   * @param  {string} state         A unique state that will be returned to you on your redirect URI.
   */
  buildAuthorizationEndpoint = (redirectUri, scope, state) => {
    const query = {
      response_type: "code",
      client_id: this._clientId,
      redirect_uri: redirectUri,
    };

    if (scope) {
      if (Array.isArray(scope)) {
        query.scope = scope.join(" ");
      } else {
        query.scope = scope;
      }
    } else {
      query.scope = "public";
    }

    if (state) {
      query.state = state;
    }

    return `https://${VIMEO_HOSTNAME}${
      AUTH_ENDPOINTS.authorization
    }?${qsModule.stringify(query)}`;
  };

  /**
   * Generates an unauthenticated access token. This is necessary to make unauthenticated requests
   *
   * @param  {string|string[]} scope  An array of scopes. See https://developer.vimeo.com/api/authentication#scopes
   *                          for more.
   */
  generateClientCredentials = async (scope) => {
    const query = {
      grant_type: "client_credentials",
    };

    if (scope) {
      if (Array.isArray(scope)) {
        query.scope = scope.join(" ");
      } else {
        query.scope = scope;
      }
    } else {
      query.scope = "public";
    }

    try {
      const url = `https://${VIMEO_HOSTNAME}/${AUTH_ENDPOINTS.clientCredentials}`;
      const config = {
        headers: {
          ...this._requestOptions.headers,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      };
      const response = await Axios.post(url, query, config);
      return response.data;
    } catch (error) {
      throw error;
    }
  };

  _buildRequestOptions = (options) => {
    let requestOptions = {
      ...options,
      method: options.method || "GET",
      headers: options.headers || {},
      data: options.data,
    };

    // Apply the default headers
    if (this._requestOptions.headers) {
      for (let key in this._requestOptions.headers) {
        if (!requestOptions.headers[key]) {
          requestOptions.headers[key] = this._requestOptions.headers[key];
        }
      }
    }

    if (this._accessToken) {
      requestOptions.headers.Authorization = `Bearer ${this._accessToken}`;
    } else if (this._clientId && this._clientSecret) {
      const basicToken = `${this._clientId}:${this._clientSecret}`;
      requestOptions.headers.Authorization = `Basic ${basicToken}`;
    }

    if (
      ["POST", "PATCH", "PUT", "DELETE"].indexOf(requestOptions.method) !==
        -1 &&
      !requestOptions.headers["Content-Type"]
    ) {
      // Set proper headers for POST, PATCH and PUT bodies.
      requestOptions.headers["Content-Type"] = "application/json";
    }

    return requestOptions;
  };

  /**
   * Performs an API call.
   *
   * Can be called one of two ways:
   *
   * 1. Url
   *    If a url is provided, we fill in the rest of the request options with defaults
   *    (GET http://api.vimeo.com/{url}).
   *
   * 2. Options
   *    Url is the only required parameter.
   *
   *    - data (will be applied to the url if request is a POST request)
   *    - headers
   *    - url (can include a querystring)
   *    - method
   *
   *
   * @param {string|Object} options   String path (default GET), or object with `method`, `url`,
   *                                  `body` or `headers`.
   */
  request = async (options) => {
    // If a URL was provided, build an options object.
    if (typeof options === "string") {
      options.method = "GET";
    }

    // If we don't have a `url` at this point, error. The `url` is the only required field.
    // We have defaults for everything else important.
    if (typeof options.url !== "string") {
      return new Error("You must provide an API url");
    }

    const requestOptions = this._buildRequestOptions(options);

    try {
      const response = await Axios(requestOptions);
      return response.data;
    } catch (error) {
      throw error;
    }
  };

  /**
   * Take an upload attempt and perform the actual upload via tus.
   *
   * https://tus.io/
   *
   * @param {string}    file          Path to the file you wish to upload.
   * @param {integer}   fileSize          Size of the file that will be uploaded.
   * @param {Object}    attempt           Upload attempt data.
   * @param {Function}  completeCallback  Callback to be executed when the upload completes.
   * @param {Function}  progressCallback  Callback to be executed when the upload progress is updated.
   * @param {Function}  errorCallback     Callback to be executed when the upload returns an error.
   */
  _performTusUpload = (
    file,
    fileSize,
    attempt,
    completeCallback,
    progressCallback,
    errorCallback
  ) => {
    let fileUpload = file;

    if (typeof file === "string") {
      fileUpload = fs.createReadStream(file);
    }

    const upload = new tus.Upload(fileUpload, {
      endpoint: "none",
      uploadSize: fileSize,
      retryDelays: [0, 1000, 3000, 5000],
      onError: errorCallback,
      onProgress: progressCallback,
      onSuccess: function () {
        return completeCallback(attempt.uri);
      },
    });

    upload.url = attempt.upload.upload_link;
    return upload;
    // upload.start();
  };

  /**
   * Upload a file.
   *
   * This should be used to upload a local file. If you want a form for your site to upload direct to
   * Vimeo, you should look at the `POST /me/videos` endpoint.
   *
   * https://developer.vimeo.com/api/reference/videos#upload_video
   *
   * @param {string}    file              Path to the file you wish to upload.
   * @param {Object=}   params            Parameters to send when creating a new video (name,
   *                                      privacy restrictions, etc.). See the API documentation for
   *                                      supported parameters.
   * @param {Function}  completeCallback  Callback to be executed when the upload completes.
   * @param {Function}  progressCallback  Callback to be executed when upload progress is updated.
   * @param {Function}  errorCallback     Callback to be executed when the upload returns an error.
   */
  upload = async (
    file,
    params,
    completeCallback,
    progressCallback,
    errorCallback
  ) => {
    const _self = this;
    let fileSize;

    if (typeof params === "function") {
      errorCallback = progressCallback;
      progressCallback = completeCallback;
      completeCallback = params;
      params = {};
    }

    if (typeof file === "string") {
      try {
        fileSize = fs.statSync(file).size;
      } catch (error) {
        errorCallback("Unable to locate file to upload.");
        return null;
      }
    } else {
      fileSize = file.size;
    }

    // Ignore any specified upload approach and size
    if (typeof params.upload === "undefined") {
      params.upload = {
        approach: "tus",
        size: fileSize,
      };
    } else {
      params.upload.approach = "tus";
      params.upload.size = fileSize;
    }

    const url = `/me/videos?field=uri,name,upload`;

    try {
      const response = await Axios.post(url, params, {
        headers: this._requestOptions.headers,
      });
      return _self._performTusUpload(
        file,
        fileSize,
        response.data,
        completeCallback,
        progressCallback,
        errorCallback
      );
    } catch (error) {
      errorCallback("Unable to initiate an upload. [" + error + "]");
      return null;
    }
  };

  /**
   * Replace the source of a single Vimeo video.
   *
   * https://developer.vimeo.com/api/reference/videos#create_video_version
   *
   * @param {string}    file              Path to the file you wish to upload.
   * @param {string}    videoUri          Video URI of the video file to replace.
   * @param {Object=}   params            Parameters to send when creating a new video (name,
   *                                      privacy restrictions, etc.). See the API documentation for
   *                                      supported parameters.
   * @param {Function}  completeCallback  Callback to be executed when the upload completes.
   * @param {Function}  progressCallback  Callback to be executed when upload progress is updated.
   * @param {Function}  errorCallback     Callback to be executed when the upload returns an error.
   */
  replace = async (
    file,
    videoUri,
    params,
    completeCallback,
    progressCallback,
    errorCallback
  ) => {
    const _self = this;
    let fileSize;

    if (typeof params === "function") {
      errorCallback = progressCallback;
      progressCallback = completeCallback;
      completeCallback = params;
      params = {};
    }

    if (typeof file === "string") {
      try {
        fileSize = fs.statSync(file).size;
      } catch (e) {
        errorCallback("Unable to locate file to upload.");
        return null;
      }

      params.file_name = path.basename(file);
    } else {
      fileSize = file.size;
      params.file_name = file.name;
    }

    // Ignore any specified upload approach and size.
    if (typeof params.upload === "undefined") {
      params.upload = {
        approach: "tus",
        size: fileSize,
      };
    } else {
      params.upload.approach = "tus";
      params.upload.size = fileSize;
    }

    const url = videoUri + "/versions?fields=upload";

    // Use JSON filtering so we only receive the data that we need to make an upload happen.
    try {
      const response = await Axios.post(url, params, {
        headers: this._requestOptions.headers,
      });
      const data = response.data;

      data.uri = videoUri;

      return _self._performTusUpload(
        file,
        fileSize,
        data,
        completeCallback,
        progressCallback,
        errorCallback
      );
    } catch (error) {
      errorCallback("Unable to initiate an upload. [" + error + "]");
      return null;
    }
  };
}

export default Vimeo;
