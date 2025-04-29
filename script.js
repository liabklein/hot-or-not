// DOM Elements
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const ratingEl = document.getElementById('rating');
const explanationEl = document.getElementById('explanation');
const detailsEl = document.getElementById('details'); // Optional details
const errorEl = document.getElementById('error');
const chartCanvas = document.getElementById('tempDistributionChart');

// --- Configuration ---
const DATE_WINDOW_DAYS = 5; // +/- 5 days
const HISTORY_YEARS = 30; // Use last 30 years

// --- Global Chart Variable ---
let tempChart = null; // To hold the chart instance

// --- PWA Service Worker Registration ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            })
            .catch(err => {
                console.log('ServiceWorker registration failed: ', err);
            });
    });
}

// --- Main App Logic ---
window.addEventListener('load', () => {
    getLocation();
});

function getLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(handleLocationSuccess, handleLocationError, {
            enableHighAccuracy: false, // Faster, less battery
            timeout: 10000,          // 10 seconds timeout
            maximumAge: 300000       // Allow cached position up to 5 mins old
         });
    } else {
        showError("Geolocation is not supported by this browser.");
    }
}

function handleLocationSuccess(position) {
    const lat = position.coords.latitude;
    const lon = position.coords.longitude;
    statusEl.textContent = `Location found (${lat.toFixed(2)}, ${lon.toFixed(2)}). Fetching weather data...`;
    getWeatherAndAnalysis(lat, lon);
}

function handleLocationError(error) {
    let message = "Could not get location.";
    switch (error.code) {
        case error.PERMISSION_DENIED:
            message = "Location permission denied. Please enable location access.";
            break;
        case error.POSITION_UNAVAILABLE:
            message = "Location information is unavailable.";
            break;
        case error.TIMEOUT:
            message = "The request to get user location timed out.";
            break;
        case error.UNKNOWN_ERROR:
            message = "An unknown error occurred while getting location.";
            break;
    }
    showError(message);
}

async function getWeatherAndAnalysis(lat, lon) {
    try {
        // 1. Define Dates
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD

        // --- Date Window Calculation ---
        const windowStartDate = new Date(today);
        windowStartDate.setDate(today.getDate() - DATE_WINDOW_DAYS);
        const windowEndDate = new Date(today);
        windowEndDate.setDate(today.getDate() + DATE_WINDOW_DAYS);

        const windowStartMonthDay = `${String(windowStartDate.getMonth() + 1).padStart(2, '0')}-${String(windowStartDate.getDate()).padStart(2, '0')}`; // MM-DD
        const windowEndMonthDay = `${String(windowEndDate.getMonth() + 1).padStart(2, '0')}-${String(windowEndDate.getDate()).padStart(2, '0')}`; // MM-DD

        // --- Historical Year Range ---
        const currentYear = today.getFullYear();
        const startYear = currentYear - HISTORY_YEARS;
        const endYear = currentYear - 1; // Use data up to last complete year

        // Format historical start/end dates for API
        // IMPORTANT: Need to be careful with year boundaries if window crosses Dec/Jan
        // For simplicity, this example assumes the window stays within the same year,
        // which is usually true for a +/- 5 day window unless near year end/start.
        // A more robust solution would handle crossing year boundaries.
        const historicalStartDate = `${startYear}-01-01`; // Fetch full years for simplicity
        const historicalEndDate = `${endYear}-12-31`; // Fetch full years for simplicity

        // 2. Fetch Forecast Data (Today's High) - Using Open-Meteo
        const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&timezone=auto&forecast_days=1&temperature_unit=fahrenheit`;

        const forecastResponse = await fetch(forecastUrl);
        if (!forecastResponse.ok) throw new Error(`Forecast API error: ${forecastResponse.statusText}`);
        const forecastData = await forecastResponse.json();

        if (!forecastData.daily || !forecastData.daily.temperature_2m_max || forecastData.daily.temperature_2m_max.length === 0) {
             throw new Error("Could not retrieve today's forecast high temperature.");
        }
        const todayForecastHigh = forecastData.daily.temperature_2m_max[0];

        // 3. Fetch Historical Data (Daily Highs for Window over Years) - Using Open-Meteo
         statusEl.textContent = `Workspaceing historical data (${startYear}-${endYear})... This may take a moment.`;
        const historicalUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${historicalStartDate}&end_date=${historicalEndDate}&daily=temperature_2m_max&temperature_unit=fahrenheit`;

        const historicalResponse = await fetch(historicalUrl);
        if (!historicalResponse.ok) throw new Error(`Historical API error: ${historicalResponse.statusText}`);
        const historicalData = await historicalResponse.json();

        if (!historicalData.daily || !historicalData.daily.time || !historicalData.daily.temperature_2m_max) {
            throw new Error("Historical data format invalid or missing.");
        }

        // 4. Filter Historical Data for the Date Window (MM-DD) across all years
        const historicalValuesInWindow = [];
        for (let i = 0; i < historicalData.daily.time.length; i++) {
            const dateStr = historicalData.daily.time[i]; // YYYY-MM-DD
            const monthDay = dateStr.substring(5); // Get MM-DD part
            const temp = historicalData.daily.temperature_2m_max[i];

            // Check if the monthDay is within our target window (MM-DD comparison)
            // This comparison handles year boundaries correctly for MM-DD strings
            if (monthDay >= windowStartMonthDay && monthDay <= windowEndMonthDay && temp !== null) {
                 historicalValuesInWindow.push(temp);
            }
             // Handle window crossing year boundary (e.g., Dec 28 - Jan 02)
             else if (windowStartMonthDay > windowEndMonthDay) { // Indicates window crosses year boundary
                 if ((monthDay >= windowStartMonthDay || monthDay <= windowEndMonthDay) && temp !== null) {
                     historicalValuesInWindow.push(temp);
                 }
             }
        }

        if (historicalValuesInWindow.length < 30) { // Need a reasonable sample size
            console.warn(`Warning: Only ${historicalValuesInWindow.length} historical data points found for the window.`);
            if(historicalValuesInWindow.length === 0) {
                 throw new Error(`No historical data found for the date window ${windowStartMonthDay} to ${windowEndMonthDay} between ${startYear}-${endYear}.`);
            }
        }


        // 5. Calculate Statistics
        const { mean, stdDev } = calculateMeanAndStdDev(historicalValuesInWindow);
        if (stdDev === 0 || isNaN(stdDev)) {
             // Avoid division by zero or NaN results
             throw new Error("Could not calculate valid standard deviation (possibly identical historical values or insufficient data).");
        }
        const zScore = (todayForecastHigh - mean) / stdDev;

        // 6. Determine Rating and Explanation
        const { rating, explanation } = generateRatingAndExplanation(zScore, today.getMonth()); // Pass month for context

        // 7. Display Results
        displayResults(rating, explanation, todayForecastHigh, mean, stdDev, historicalValuesInWindow);

    } catch (error) {
        console.error("Error in getWeatherAndAnalysis:", error);
        showError(`Failed to get weather analysis: ${error.message}`);
    }
}


// --- Helper Functions ---

function calculateMeanAndStdDev(data) {
    const n = data.length;
    if (n === 0) return { mean: NaN, stdDev: NaN };

    const mean = data.reduce((a, b) => a + b) / n;

    if (n === 1) return { mean: mean, stdDev: 0 }; // Std dev is 0 for single point

    const variance = data.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1); // Sample variance (N-1)
    const stdDev = Math.sqrt(variance);

    return { mean, stdDev };
}

function getMonthContext(monthIndex) {
    // Simple mapping from month index (0-11) to season/time context
    const monthNames = ["early January", "mid-February", "early March", "mid-April", "late May", "mid-June",
                        "early July", "mid-August", "late September", "mid-October", "early November", "mid-December"];
    // Adjust phrasing based on the day of the month if needed, but this is simpler
    // For April 22nd (index 3), it returns "mid-April"
    return monthNames[monthIndex] || "this time of year";
}

function generateRatingAndExplanation(z, monthIndex) {
    const absZ = Math.abs(z);
    let rating = "Average";
    let qualifier = "about average";
    let direction = z >= 0 ? "above" : "below";

    if (absZ > 3.0) {
        rating = "Very Unusual";
        qualifier = z > 0 ? "much warmer" : "much colder";
    } else if (absZ > 2.0) {
        rating = "Unusual";
        qualifier = z > 0 ? "warmer" : "colder";
    } else if (absZ > 1.0) {
        rating = "Slightly Unusual";
         qualifier = z > 0 ? "slightly warmer" : "slightly colder";
    } else if (absZ <= 0.5){ // Add tighter definition for 'about average'
        qualifier = "about average";
        direction = "at"; // Change direction word for average case
        if (z === 0) direction = "exactly at"; // Edge case
    } else { // 0.5 < absZ <= 1.0
         qualifier = z > 0 ? "slightly warmer" : "slightly colder";
    }


    const timeContext = getMonthContext(monthIndex);
    const explanation = `It is ${qualifier} than average for ${timeContext}. The high temperature is ${absZ.toFixed(1)} standard deviations ${direction} normal for this time of year.`;

    return { rating, explanation };
}

function displayResults(rating, explanation, todayHigh, avg, stdDev, historicalData) {
    statusEl.classList.add('hidden');
    errorEl.classList.add('hidden');

    ratingEl.textContent = rating;
    explanationEl.textContent = explanation;
    displayChart(historicalData, todayHigh, avg, stdDev);

    resultEl.classList.remove('hidden');
}

function showError(message) {
    statusEl.classList.add('hidden');
    resultEl.classList.add('hidden');
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
}

function displayChart(historicalTemps, todayTemp, meanTemp, stdDevTemp) {
    if (!chartCanvas) {
        console.error("Canvas element not found!");
        return;
    }
    const ctx = chartCanvas.getContext('2d');

    // Destroy previous chart instance if it exists
    if (tempChart) {
        tempChart.destroy();
    }

    // Prepare data for scatter plot
    const historicalDataPoints = historicalTemps.map(temp => ({
        x: temp,
        y: Math.random() * 0.6 - 0.3 // Add random jitter (-0.3 to +0.3) for visibility
    }));

    const todayDataPoint = [{
        x: todayTemp,
        y: 0 // Place today's temp distinctly at y=0
    }];

    // Calculate positions for standard deviation lines
    const plusOneStdDev = meanTemp + stdDevTemp;
    const minusOneStdDev = meanTemp - stdDevTemp;

    tempChart = new Chart(ctx, {
        type: 'scatter', // Use scatter plot to show individual points
        data: {
            datasets: [
                {
                    label: 'Historical Highs (Last 30yrs, ±5 days)',
                    data: historicalDataPoints,
                    backgroundColor: 'rgba(54, 162, 235, 0.5)', // Blueish, semi-transparent
                    borderColor: 'rgba(54, 162, 235, 0.8)',
                    pointRadius: 3, // Small points
                    pointHoverRadius: 5
                },
                {
                    label: "Today's Forecast High",
                    data: todayDataPoint,
                    backgroundColor: 'rgba(255, 99, 132, 1)', // Red
                    borderColor: 'rgba(255, 99, 132, 1)',
                    pointRadius: 6, // Larger point for today
                    pointHoverRadius: 8,
                    order: -1 // Try to draw today's point on top
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false, // Allow chart height to be controlled by CSS
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    title: {
                        display: true,
                        text: 'Temperature (°F)'
                    }
                },
                y: {
                    // Hide the Y axis as jitter is just for visual separation
                    display: false,
                    min: -1, // Give slight vertical room
                    max: 1
                }
            },
            plugins: {
                legend: {
                    display: true,
                     position: 'bottom',
                     labels: {
                        boxWidth: 12,
                        padding: 15
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            // Custom tooltip label
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.x !== null) {
                                label += `${context.parsed.x.toFixed(1)}°F`;
                            }
                            // Hide Y value in tooltip
                            return label;
                        }
                    }
                },
                // --- Annotation Plugin Configuration ---
                annotation: {
                    annotations: {
                        meanLine: {
                            type: 'line',
                            xMin: meanTemp,
                            xMax: meanTemp,
                            borderColor: 'rgba(75, 192, 192, 0.8)',
                            borderWidth: 2,
                            borderDash: [6, 6],
                            yScaleID: 'y', // Explicitly target the y-axis scale
                            label: {
                                content: `Avg: ${meanTemp.toFixed(1)}°F`,
                                display: true,
                                yValue: 1, // Anchor the label's reference point to y=1 (top of scale)
                                yAdjust: -30,
                                // position: { x: 'top' , y: 'top'},
                                // yAdjust: -95,
                                // xAdjust: 0,
                                font: { size: 10 },
                                color: '#444',
                                backgroundColor: 'rgba(255, 255, 255, 0.75)'
                            }
                        },
                        plusOneStdDevLine: {
                             type: 'line',
                             xMin: plusOneStdDev,
                             xMax: plusOneStdDev,
                             borderColor: 'rgba(255, 159, 64, 0.7)',
                             borderWidth: 1.5,
                             borderDash: [6, 6],
                             // yScaleID: 'y', // Explicitly target the y-axis scale
                             label: {
                                 content: `+1σ: ${plusOneStdDev.toFixed(1)}°F`,
                                 display: true,
                                 yValue: 1, // Anchor to top of scale
                                 yAdjust: -30,
                                 // position: { x: 'center'},
                                 // yAdjust: -95,
                                 xAdjust: 10, // Nudge right
                                 font: { size: 10 },
                                 color: '#444',
                                 backgroundColor: 'rgba(255, 255, 255, 0.75)'
                             }
                         },
                         minusOneStdDevLine: {
                             type: 'line',
                             xMin: minusOneStdDev,
                             xMax: minusOneStdDev,
                             borderColor: 'rgba(255, 159, 64, 0.7)',
                             borderWidth: 1.5,
                             borderDash: [6, 6],
                             // yScaleID: 'y', // Explicitly target the y-axis scale
                             label: {
                                 content: `-1σ: ${minusOneStdDev.toFixed(1)}°F`,
                                 display: true,
                                 yValue: 1, // Anchor to top of scale
                                 yAdjust: -30,
                                 // position: { x: 'center'},
                                 // yAdjust: -95,
                                 xAdjust: -10,// Nudge left
                                 font: { size: 10 },
                                 color: '#444',
                                 backgroundColor: 'rgba(255, 255, 255, 0.75)'
                             }
                         }
                    }
                } // End annotation plugin
            } // End plugins
        } // End options
    }); // End new Chart
}