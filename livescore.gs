/**
 * Show Jumping Live Scoring spreadsheet.
 *
 * Version 20180701.
 * Based on Equestrian Australia Rules for 2018/07/01
 *
 * @copyright  2019 Andrew Nicols <andrew@nicols.co.uk>
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 *
 * This is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * It is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 */

// TODO
// - Defer back to first round placings where not enough competitors were present to compete in the second round.
// - Support options for rounds being against the clock, or not against the clock according to Article 238.1 and 238.2.
// - Automatically eliminate riders for exceeding the Time Limit.
// - Document the world.
// - Add references to rules.

var Results = {
    Eliminated: 'E',
    Retired: 'RET',
};

// Accepted values are:
// - Clear: "/" or "."
// - Knockdown: K, or 4, or 4k
// - Refusal: R, or 4R, or 8R
// - Refusal with rebuild required: RB
// - Fall of rider: FR
// - Fall of horse: FH
// - Error of course: EOC
// - Time exceeded: T
// - Outside Assistance: A
// - Retired: RET
var Penalties = {
  clear: {
    desc: "Clear",
    values: ["/", "."],
    faultPenalty: 0,
    timePenalty: 0,
    isEliminated: false,
    isRetired: false,
  },
  knockdown: {
    desc: "Knockdown",
    values: ["4", "4k", "k"],
    faultPenalty: 4,
    timePenalty: 0,
    isEliminated: false,
    isRetired: false,
  },
  refusal: {
    desc: "Refusal",
    values: ["r", "4r", "8r"],
    faultPenalty: calculateRefusalPenalty,
    timePenalty: 0,
    isEliminated: false,
    isRetired: false,
  },
  rebuild: {
    desc: "Refusal with a rebuild of the jump required. Six seconds will be added to the time taken.",
    values: ["rb"],
    // Note: Do not include a fault penalty here. The penalty is handled by the countAs.
    faultPenalty : 0,
    timePenalty: 6,
    countAs: 'refusal',
    isEliminated: false,
    isRetired: false,
  },
  fallOfHorse: {
    desc: "Fall of Horse",
    values: ["fh"],
    faultPenalty: Results.Eliminated,
    timePenalty: Results.Eliminated,
    isEliminated: true,
    isRetired: false,
  },
  fallOfRider: {
    desc: "Fall of Rider",
    values: ["fr"],
    faultPenalty: Results.Eliminated,
    timePenalty: Results.Eliminated,
    isEliminated: true,
    isRetired: false,
  },
  timeExceeded: {
    desc: "The time limit for the round was exceeded",
    values: ["t"],
    faultPenalty: Results.Eliminated,
    timePenalty: Results.Eliminated,
    isEliminated: true,
    isRetired: false,
  },
  errorOfCourse: {
    desc: "The rider made an error of course",
    values: ["eoc"],
    faultPenalty: Results.Eliminated,
    timePenalty: Results.Eliminated,
    isEliminated: true,
    isRetired: false,
  },
  outsideAssitance: {
    desc: "The rider received outside assistance",
    values: ["a"],
    faultPenalty: Results.Eliminated,
    timePenalty: Results.Eliminated,
    isEliminated: true,
    isRetired: false,
  },
  retired: {
    desc: "The rider chose to retire",
    values: ["ret"],
    faultPenalty: Results.Retired,
    timePenalty: Results.Retired,
    isEliminated: false,
    isRetired: true,
  },
};

var SpeedTable = [
    {
        lower: 0,
        upper: 34,
        indoor: 250,
        outdoor: 250,
    },
    {
        lower: 35,
        upper: 84,
        indoor: 300,
        outdoor: 300,
    },
    {
        lower: 85,
        upper: 104,
        indoor: 325,
        outdoor: 325,
    },
    {
        lower: 105,
        upper: 130,
        indoor: 350,
        outdoor: 350,
    },
    {
        lower: 130,
        upper: 200,
        indoor: 375,
        outdoor: 375,
    },
];

/**
 * Calculate the default speed for the given height and location.
 *
 * Note: This calculation adds PCWA values.
 *
 * For a Lead-Line class, please use a height of 0.
 * Options for Arena location are "Indoor" and "Outdoor".
 *
 * @param   Number  height The height of the course
 * @param   String  location Whether the course is held in an indoor or outdoor arena.
 * @return  Number  The number of meters per second
 */
function getSpeedForHeight(height, location) {
    if ('Lead Line' === height) {
        height = 0;
    }

    location = location || 'Outdoor';


    var index = 0,
        speedRange;

    for (index in SpeedTable) {
        speedRange = SpeedTable[index];
        if (height >= speedRange.lower && height < speedRange.upper) {
            if ('Indoor' === location) {
                return speedRange.indoor;
            } else {
                return speedRange.outdoor;
            }
        }
    }

    throw Error("Unable to find a speed for " + height);
}

/**
 * Map the classifications according to possible values.
 *
 * @return  Object The map of possible keyboard shortcut to meaning.
 */
var classificationMap = getClassificationMap();
function getClassificationMap() {
  var classificationMap = {};

  var type;
  var classification;
  var value;

  for (var type in Penalties) {
    classification = Penalties[type];
    classification.type = type;

    classification.values.forEach(function(value) {
      classificationMap["" + value] = classification;
    });
  }

  return classificationMap;
};

/**
 * Fill the values for the current rows:
 * - Total Time including the actual Time Taken and any rebuild penalty
 * - Time penalties
 * - Jumping penalties
 * - Total penalties
 *
 * These are returned as an 3-dimensional Array (column => row).
 *
 * @param   Number  height The height of the round. Used when calculating the penalties for Refusals according to Annex
 *                         II of the EA Jumping Rules.
 * @param   Number timeAllowed The time allowed for the round.
 */
function fillAllPenalties(height, timeAllowed, values, timeTaken, timePenaltyPeriod, timePenaltyAmount) {
    // Order of fields is:
    // Time including rebuilds
    // Time penalties
    // Jumping penalties
    // Total penalties
    var timeIncRebuild = '',
        timePenalty = '',
        jumpPenalty = '',
        totalPenalty = '';

    var result = getRoundValues(height, values);
    if (result) {
        jumpPenalty = result.penalty;

        if (result.isEliminated) {
            totalPenalty = Results.Eliminated;
        } else if (result.isRetired) {
            totalPenalty = Results.Retired;
        } else {
            // Time penalty:
            // Seconds over = MAX(0, Time taken - timeAllowed)
            // Seconds over / Time Penalty period (i.e. 4)
            // Seconds over / Time Penalty period  * Penalty period
            timeIncRebuild = 0 + timeTaken + result.timeAddition;

            if (timeIncRebuild > (timeAllowed * 2)) {
                // The time taken exceeded the time allowed.
                totalPenalty = Results.Eliminated;
                jumpPenalty = '';
            } else {
                timePenalty = Math.ceil(Math.max(0, timeIncRebuild - timeAllowed) / timePenaltyPeriod) * timePenaltyAmount;
                totalPenalty = timePenalty + jumpPenalty;
            }
        }
    }

    var rowResult = [timeIncRebuild, timePenalty, jumpPenalty, totalPenalty];

    return [rowResult];
}

/**
 * Calculate the penalties for the round.
 *
 * @param   Number  height The height of jumps on the round
 * @param   Range   values The values
 * @return  String
 */
function calculatePenalties(height, values) {
    var result = getRoundValues(height, values);
    if (result && result.penalty) {
        return result.penalty;
    }

    return '';
}


/**
 * Calculate the time additions for the round.
 *
 * @param   Number  height The height of jumps on the round
 * @param   Range   values The values
 * @return  String
 */
function calculateRebuildTimes(height, values) {
    var result = getRoundValues(height, values);
    if (result) {
        return result.timeAddition;
    }

    return '';
}

function getRoundValues(height, values) {
    Logger.log("Checking values for " + height + ":", values);
    var allValues = getFilledValuesForRound(values);

    var roundClassifications = {};
    allValues.forEach(function(value) {
        if (("" + value) === "0") {
            // Sheets treats the value '/' as 0/0 rather than a string.
            // This happens before it is passed in.
            value = "/";
        }
        if (typeof classificationMap[value] === 'undefined') {
            throw Error('Unable to find a classification for ' + value);
            return;
        }

        var classification = classificationMap[value];
        var countAsClassification;
        if (!roundClassifications[classification.type]) {
            roundClassifications[classification.type] = {
                count: 0,
                faultPenalty: classification.faultPenalty,
                timePenalty: classification.timePenalty,
                isEliminated: classification.isEliminated,
                isRetired: classification.isRetired,
            };

            if (classification.countAs) {
                if ('undefined' === typeof Penalties[classification.countAs]) {
                    throw Error('Unable to find a classification for countAs:' + classification.countAs);
                }

                countAsClassification = Penalties[classification.countAs];
                roundClassifications[classification.type].countAs = classification.countAs;

                if (!roundClassifications[classification.countAs]) {
                    roundClassifications[classification.countAs] = {
                        count: 0,
                        faultPenalty: countAsClassification.faultPenalty,
                        timePenalty: countAsClassification.timePenalty,
                        isEliminated: classification.isEliminated,
                        isRetired: classification.isRetired,
                    };
                }
            }
        }

        roundClassifications[classification.type].count++;
        if (classification.countAs) {
            roundClassifications[classification.countAs].count++;
        }
    });

    return getAccumulatedPenalties(height, roundClassifications);
}

function getFilledValuesForRound(values) {
    var allValues = [],
        rowNo = 0,
        colNo = 0,
        value;

    for (rowNo = 0; rowNo < values.length; rowNo++) {
        for (colNo = 0; colNo < values[rowNo].length; colNo++) {
            cellValue = values[rowNo][colNo];

            // Normalise the string.
            cellValue = "" + cellValue + "";
            cellValue = "" + cellValue.toLowerCase() + "";

            if (!cellValue.length || !cellValue.trim().length) {
                // Nothing in the cellValue.
                continue;
            }

            cellValue.split(',').forEach(function(value) {
                allValues.push(value);
            });
        }
    }

    return allValues;
}

function getAccumulatedPenalties(height, roundClassifications) {
    var runningScore = 0;
    var currentJumpScore = 0;

    var runningTimeAddition = 0;
    var currentJumpTimeAddition = 0;

    var type;
    var thisClassification;

    var isEliminated = false,
        isRetired = false,
        hasAnyValue = false;

    for (type in roundClassifications) {
        hasAnyValue = true;
        thisClassification = roundClassifications[type];
        if ('function' === typeof thisClassification.faultPenalty) {
            currentJumpScore = thisClassification.faultPenalty(height, thisClassification.count)
        } else if (thisClassification.isEliminated) {
            currentJumpScore = thisClassification.faultPenalty;
        } else if (thisClassification.isRetired) {
            currentJumpScore = thisClassification.faultPenalty;
        } else {
            currentJumpScore = (thisClassification.faultPenalty * thisClassification.count);
        }

        Logger.log("Current jump score is " + currentJumpScore);
        if (Results.Eliminated === currentJumpScore) {
            isEliminated = true;
            runningScore = currentJumpScore;
            runningTimeAddition = '';
            break;
        }

        if (Results.Retired === currentJumpScore) {
            isRetired = true;
            runningScore = currentJumpScore;
            runningTimeAddition = '';
            break;
        }

        runningScore += currentJumpScore;
        runningTimeAddition += thisClassification.timePenalty;
    }

    if (!hasAnyValue) {
        return;
    }

    return {
        penalty: runningScore,
        timeAddition: runningTimeAddition,
        isEliminated: isEliminated,
        isRetired: isRetired,
    };
}

function calculateRefusalPenalty(height, count) {
    // https://www.equestrian.org.au/sites/default/files/Annex%20II%20%20Speed%20and%20Elimination%20Table.pdf
    if (count) {
        if (count === 1) {
            return 4;
        }
        if (height <= 115) {
            // At heights at or below 115, 2 disobediences are allowed.
            if (2 === count) {
                return 4 + 8;
            }
        }

        // At heights above 115, only 2 disobediences are allowed.
        return Results.Eliminated;
    }

    return '';
}

function getPlacingsForRange(allTotals) {
    var placingTotals = allTotals
        .filter(function(val) { return val.length; })
        .map(function(val) { return val[0];})
        .filter(function(val) { return ("" + val).length; })
        .sort(sortByPenalty);

    var allPlacings = allTotals.map(function(curRow) {
        var thisTotal = curRow[0];
        if ('' === ("" + thisTotal).trim()) {
            return [''];
        }

        var position = placingTotals.indexOf(thisTotal) + 1;
        var othersFound = (-1 !== placingTotals.indexOf(thisTotal, position));

        if (othersFound) {
            return ["" + position + "="];
        } else {
            return ["" + position];
        }
    });

    return allPlacings;
}

function getPlacingsForRangeWithTime(allTotals, allTimes) {
    var placingTotals = allTotals
        .filter(function(val) { return val.length; })
        .map(function(val) { return val[0];})
        .filter(function(val) { return ("" + val).length; })
        .sort(sortByPenalty);

    var faultsWithTime = [];
    allTotals
        .map(function(val) { return val[0]; })
        .forEach(function(curTotal, index) {
            if (!("" + curTotal).length) {
                // This row is empty. Skip it.
                return;
            }

            faultsWithTime.push({
                originalIndex: index,
                fault: curTotal,
                time: allTimes[index][0],
            });
        });

    // We return a placing for each row. These rows must match the order of the allTotals/allTimes rows.
    var allPlacings = [];
    allTotals.forEach(function(curRow, index) {
        // Find the position of this fault penalty amongst its peers.
        var thisTotal = curRow[0];
        if ('' === ("" + thisTotal).trim()) {
            // Empty row - append an empty row..
            allPlacings.push(['']);
            return;
        }

        // First find the position according to the total number of faults.
        // Then see if any other competitor has the same number of total faults.
        var position = placingTotals.indexOf(thisTotal) + 1;
        var equalPosition = (-1 !== placingTotals.indexOf(thisTotal, position));

        if (equalPosition) {
            // Other competitors shared the same number of total faults.
            // We now need to find all other competitors who has the same number of faults, and place them by their time.

            // Grab the time for this round.
            var thisTime = allTimes[index][0];

            // Now find the rows with a matching fault total.
            var positionBehindFaultLeader = 0;
            equalPosition = false;
            faultsWithTime.forEach(function(faultWithTime) {
                if (faultWithTime.originalIndex === index) {
                    // Skip the row. It's the same rider.
                    return;
                }
                if ("" + thisTotal === "" + faultWithTime.fault) {
                    // This row matches the number of faults and is not the same rider.
                    if (thisTime > faultWithTime.time) {
                        // This rider is behind the current rider by time.
                        positionBehindFaultLeader++;
                    } else if (thisTime === faultWithTime.time) {
                        // This rider has the same time as our rider.
                        // They will receive equal positions.
                        equalPosition = true;
                    }
                }
            });

            var finalPosition = "" + (position + positionBehindFaultLeader);
            if (equalPosition) {
                finalPosition += "=";
            }
            allPlacings.push([finalPosition]);
        } else {
            // No other competitor has the same number of faults, therefore this position is their final.
            allPlacings.push(["" + position]);
        }
    });

    return allPlacings;
}

/**
 * Compare the two values for use in the Sort function.
 *
 * This function will sort riders by Penalty, also taking into consideration Eliminations and Retirements according to
 * Article 247.2.
 *
 * @param   {String|Number}   a The left-hand value for comparison.
 * @param   {String|Number}   b The right-hand value for comparison.
 * @return  Number              Numeric sort comparitor for the two.
 */
function sortByPenalty(a, b) {
    // Note: Article 247.2 states:
    // An Athlete, who with the permission of the Ground Jury withdraws from a jump-off,
    // must always be placed after an athlete eliminated or who retires for a valid reason on
    // the course. Athletes, who retire for no valid reason or who have themselves eliminated
    // on purpose are placed equal with Athletes, who have withdrawn from the same jumpoff.

    // Apply a large factor to Eliminations.
    if (Results.Eliminated === a) {
        a = 10000;
    }
    if (Results.Eliminated === b) {
        b = 10000;
    }

    // Apply a large factor to Retirements to ensure that they are placed after an eliminated Athlete.
    // Note: This does not handle the "who have themselves eliminated on purpose"  aspect of this rule.
    // For this to apply correctly the judge must mark them as Retired instead of Eliminated.
    if (Results.Retired === a) {
        a = 20000;
    }
    if (Results.Retired === b) {
        b = 20000;
    }

    return a - b;
}
