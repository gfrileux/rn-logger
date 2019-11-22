import NetInfo from '@react-native-community/netinfo';
import { sendLog, bulkSendLog } from '../services/logger';
import {
  checkAsyncStorage,
  saveInAsyncStorage,
  asyncRemoveItem,
} from './helpers/common';
// constants
import { LOGGER } from '../constants/asyncStorageKeys';
import { MAX_LOCAL_ERROR_LOG_SIZE } from '../constants/params';

/*
 *
 * This function is used in the main app Listener. It is fired when the connection type of the user changes.
 * It takes in the previous State and current Sate, (two variables each time: isConnected and connectionType)
 *
 * It tries to determine if the user was offline or on a poor connection, but is now on Wifi
 *
 * RETURNS TRUE or FALSE
 *
 */
const checkUserIsBackOnFullConnection = (
  prevConnectionType,
  prevConnectionDetails,
  connectionType,
  connectionDetails
) => {
  if (!prevConnectionType && connectionType === 'wifi') {
    return true;
  }
  if (prevConnectionType === 'none' && connectionType === 'wifi') {
    return true;
  }
  if (prevConnectionType === 'unknow' && connectionType === 'wifi') {
    return true;
  }
  if (prevConnectionType === 'cellular') {
    // if the previous connection was cellular, we need to look into it a bit more
    if (
      prevConnectionDetails.cellularGeneration &&
      prevConnectionDetails.cellularGeneration !== '4g' &&
      connectionDetails.cellularGeneration &&
      connectionDetails.cellularGeneration === '4g'
    ) {
      return true;
    }
  }
  // Safe return if we don't know: false (which means nothing will happen)
  return false;
};

/*
 *
 * This function is used when we detect that the user has come back online on a strong connection after being offline.
 * It will try and see if any logs hav been stored locally. If so it will send these logs and clear the local storage
 *
 * ARGS:  none
 * RETURNS none
 *
 */

const attemptToEmptyLocalLogs = async () => {
  try {
    const existingErrorLog = await checkAsyncStorage(LOGGER);

    if (existingErrorLog) {
      // we have logs locally - let's send them to the server.
      // first we re-transform the log into a JS object
      const arryOfLogs = JSON.parse(existingErrorLog);
      try {
        const result = await bulkSendLog(arryOfLogs);

        if (result) {
          // we can now clear the local storage
          try {
            const error = await asyncRemoveItem(LOGGER);

            if (error) {
              // eslint-disable-next-line no-console
              console.error(
                "[RNCustomLogger] Couldn't clear logs from local Storage. More detail below",
                error
              );
            }
          } catch (errorClearingAsyncStorage) {
            // eslint-disable-next-line no-console
            console.error(
              "[RNCustomLogger] Couldn't clear logs from local Storage. More detail below",
              errorClearingAsyncStorage
            );
          }
        }
      } catch (errorSendingBulkLog) {
        // eslint-disable-next-line no-console
        console.error(
          "[RNCustomLogger] Couldn't send logs in bulk. More detail below",
          errorSendingBulkLog
        );
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      "[RNCustomLogger] Couldn't access local Storage. More detail below"
    );
  }
};

/*
 *
 * A simple helper function to check that the arguments sent are correct. Type and message should be a string and extra should be an object (or null)
 * Will console.log a message in __DEV__ mode if there is an issue with the arguments
 *
 * RETURNS TRUE or FALSE
 *
 */
const checkArguments = (type, message, extra) => {
  if (
    typeof type === 'string' &&
    typeof message === 'string' &&
    typeof extra === 'object'
  ) {
    return true;
  }
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn(
      '[RNCustomLogger] you passed invalid arguments, message should be a string and extra should be an object'
    );
  }
  return false;
};

/*
 *
 * A simple helper function to write log entries in a formatted way
 * Takes in the payload (type, message, data) and the position at which to write
 *
 * RETURNS a JSON stringified string of an object formatted as below:
 * result = {
 *            "Tue Aug 19 1975 23:15:30 GMT+0100 (British Summer Time)" : "error - library crashed - extra data: {stringified object}",
 *            "Fri Aug 23 1975 10:23:05 GMT+0100 (British Summer Time)" : " error - another error somewhere else crashed - extra data: {stringified object}",
 *          }
 */
const formatLogEntry = (type, message, extra, parsedErrorLog) => {
  // we don't mutate the error log but build a new one
  const newLog = { ...parsedErrorLog };
  // add the new entry using the current date as key - should be unique
  newLog[new Date()] = `${type} - ${message} - extra data : ${JSON.stringify(
    extra
  )}`;
  return newLog;
};

/*
 *
 * Another helper function to slim down the error log when it gets too big
 * Takes in a formatted error Log as below:
 * parsedErrorLog = {
 *            "Tue Aug 19 1975 23:15:30 GMT+0100 (British Summer Time)" : "error - library crashed - extra data: {stringified object}",
 *            "Fri Aug 23 1975 10:23:05 GMT+0100 (British Summer Time)" : " error - another error somewhere else crashed - extra data: {stringified object}",
 *          }
 * RETURNS : a slimmer parsedObject in the same format
 *
 */
const removeKeysFromErrorLog = parsedErrorLog => {
  // we don't mutate the error log but build a new one
  const newLog = {};
  // we count the number of keys of the old one, and we'll use only the last half
  // TODO : maybe use the date key to remove anything that's old than say 7 days, or maybe find a better way to trim the big array than just silcing in half
  const currentLogLength = Object.keys(parsedErrorLog).length;

  for (let index = currentLogLength; index > currentLogLength / 2; index -= 1) {
    // we retrieve the key and the value for that key and re-build a new smaller array
    newLog[Object.keys(parsedErrorLog)[index - 1]] =
      parsedErrorLog[Object.keys(parsedErrorLog)[index - 1]];
  }
  return newLog;
};

/*
 *
 * This function handles the logging when the user is not connected, or has poor cellular connection (Less than 4G)
 * It basically writes in the local Async Storage unless it's full in whic case it'll make a bit of space first by deleting old logs
 *
 *
 */
const logLocally = async (type, message, extra) => {
  // TODO : for now, in disconnected mode, we'll only log errors and warnings, but perhaps this needs to be revisited later
  if (type === 'warn' || type === 'error') {
    // first retrieve the key if it exists - this lets us potentially trim it before it gets too long
    try {
      const existingErrorLog = await checkAsyncStorage(LOGGER);

      if (existingErrorLog === false) {
        // Async Storage is empty - great we store the very first key
        saveInAsyncStorage(
          LOGGER,
          JSON.stringify(formatLogEntry(type, message, extra, null))
        );
      } else {
        // calculate the size of the currentLocalLog
        const errorLogSize = existingErrorLog.length * 8;
        // parse the JSON string stored in storage so we have a proper JS object
        const parsedErrorLog = JSON.parse(existingErrorLog);

        if (errorLogSize < MAX_LOCAL_ERROR_LOG_SIZE) {
          // add at the end of the existing log
          saveInAsyncStorage(
            LOGGER,
            JSON.stringify(formatLogEntry(type, message, extra, parsedErrorLog))
          );
        } else {
          // clear some space first
          // We do this by slimming down the error log, then adding the new entry, and overwriting the Async Storage key
          const slicedLog = removeKeysFromErrorLog(parsedErrorLog);

          saveInAsyncStorage(
            LOGGER,
            JSON.stringify(formatLogEntry(type, message, extra, slicedLog))
          );
        }
      }
    } catch (error) {
      // we couldn't log locally for whatever reason - we console log it so that if it happens in dev it can be picked up
      // eslint-disable-next-line no-console
      console.error(
        "[RNCustomLogger] couldn't log locally. Error detail below",
        error
      );
    }
  }
};

/*
 *
 * This is the main function
 * It simply looks for connection, and depending on the status, will either use the remote logger, or store locally
 *
 * It akes in a type, message and extra data
 *
 * It doesn return anything
 *
 */
const mainLog = (type, message, extra) => {
  if (__DEV__) {
    checkArguments(type, message, extra);
    // if we are in dev mode, we print to the console and don't send to the backend
    // eslint-disable-next-line no-console
    console.log('[RNCustomLogger] ', type, message, extra);
    return true;
  }
  // we are in production mode, so we log properly
  if (!checkArguments(type, message, extra)) {
    // the function was used with improper arguments - we exit
    return false;
  }
  // first we check the connectionInfo
  NetInfo.fetch()
    .then(state => {
      const { isConnected } = state; // TRUE or FALSE
      const connectionType = state.type; // could be wifi, cellular, bluetooth, ethernet, wimax, vpn, or other
      const cellularGeneration =
        connectionType === 'cellular' ? state.details.cellularGeneration : null; // if the network is cellular, are we on 2G, 3G or 4G ?

      // if online and well connected, we use the logger
      if (
        isConnected &&
        (connectionType === 'wifi' ||
          (connectionType === 'cellular' && cellularGeneration === '4g'))
      ) {
        // we're conected and ona  strong connection - we use the logger
        sendLog(type, message, extra);
      } else {
        // We're either disconnected or on poor connection - we log locally
        logLocally(type, message, extra);
      }
    })
    .catch(error => {
      // if we can't get the connection type, or some other weird error occured, there's not much we can do
      // we console.log it so that at least if it happens locally it'll be noticed
      // eslint-disable-next-line no-console
      console.error('[RNCustomLogger] Error fetching connection state', error);
    });
  return null;
};

const log = (message, extra = null) => {
  mainLog('log', message, extra);
};

const warn = (message, extra = null) => {
  mainLog('warn', message, extra);
};

const error = (message, extra = null) => {
  mainLog('error', message, extra);
};

const logger = {
  log,
  warn,
  error,
  attemptToEmptyLocalLogs,
  checkUserIsBackOnFullConnection,
};

export default logger;
