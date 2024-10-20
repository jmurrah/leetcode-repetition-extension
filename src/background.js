import { User, LeetCodeProblem } from './utils/models.js';

let user = null;

async function sendToAPI(endpoint, method, requestData) {
  let url = `http://localhost:8080/${endpoint}`;
  let fetchOptions = {
    method: method,
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include'
  };

  if (requestData) {
    fetchOptions.body = JSON.stringify(requestData);
  }

  while (true) {
    const response = await fetch(url, fetchOptions);
    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers));

    if (response.status === 401) {
      const challenge = response.headers.get('X-Challenge');
      const token = response.headers.get('X-Challenge-Token');
      console.log('Challenge:', challenge);
      console.log('Token:', token);

      if (challenge && token) {
        const solution = challenge.match(/\d+/g).reduce((acc, num) => acc * Number(num), 1);
        console.log('Solution:', solution);

        fetchOptions.headers['X-Challenge-Token'] = token;
        fetchOptions.headers['X-Challenge-Response'] = solution.toString();
        continue;
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const responseBody = await response.text();
    console.log('Response body:', responseBody);

    return JSON.parse(responseBody);
  }
}

function addUserCompletedProblem(problem) {
  const completedProblem = new LeetCodeProblem(
    problem.link,
    problem.titleSlug,
    problem.difficulty,
    problem.repeatDate,
    problem.lastCompletionDate
  );
  console.log('Problem Data:', completedProblem);
  console.log('User:', user.username);

  sendToAPI(`insert-row?username=${user.username}`, 'POST', completedProblem)
    .then((response) => {
      console.log('Success:', response);

      const problemsArray = Array.from(user.completedProblems.values());
      problemsArray.push(completedProblem);
      const sortedProblems = problemsArray.sort(
        (a, b) => new Date(a.repeatDate) - new Date(b.repeatDate)
      );
      user.completedProblems = new Map(
        sortedProblems.map((p) => [p.titleSlug, p])
      );

      console.log('Updated problems:', user.completedProblems);
    })
    .catch((error) => {
      console.error('Error:', error);
    });
}

function deleteUserCompletedProblem(problemTitleSlug) {
  const endpoint = `delete-row?username=${user.username}&problemTitleSlug=${problemTitleSlug}`;
  sendToAPI(endpoint, 'DELETE', null)
    .then((response) => {
      console.log('Row deleted:', response);
      user.completedProblems.delete(problemTitleSlug);
    })
    .catch((error) => {
      console.error('Error deleting row:', error);
    });
}

function initializeUser(username) {
  console.log('Initializing user:', username);
  if (username) {
    user = new User(username);
    console.log('User initialized:', user);
    // sendToAPI(`generate-key?username=${user.username}`, 'POST', {});
  }
}

async function setUserInfo() {
  console.log('Setting user info');
  return new Promise((resolve) => {
    browser.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      browser.tabs.sendMessage(
        tabs[0].id,
        { action: 'setUsername' },
        async (response) => {
          const username = response;
          console.log('Received username:', username);
          initializeUser(username);
          if (!user) {
            console.log('User not initialized');
            resolve();
            return;
          }
          try {
            const tableResponse = await sendToAPI(
              `get-table?username=${user.username}`,
              'GET',
              null
            );
            const sortedProblems = tableResponse.table
              .map(
                (problem) =>
                  new LeetCodeProblem(
                    problem.link,
                    problem.titleSlug,
                    problem.difficulty,
                    problem.repeatDate,
                    problem.lastCompletionDate
                  )
              )
              .sort((a, b) => new Date(a.repeatDate) - new Date(b.repeatDate));

            user.completedProblems = new Map(
              sortedProblems.map((problem) => [problem.titleSlug, problem])
            );
            console.log('Table Response:', user.completedProblems);
          } catch (error) {
            console.error('Error getting problem table:', error);
          }
          resolve();
        }
      );
    });
  });
}

function getUserInfo(shouldRefresh) {
  return new Promise((resolve) => {
    if (!user || shouldRefresh) {
      setUserInfo().then(() => {
        if (user) {
          resolve({
            username: user.username,
            problems: Array.from(user.completedProblems.values()),
          });
        } else {
          console.log('User not initialized');
          resolve({ username: null, problems: [] });
        }
      });
    } else {
      resolve({
        username: user.username,
        problems: Array.from(user.completedProblems.values()),
      });
    }
  });
}

function checkIfProblemCompletedInLastDay(titleSlug) {
  if (!user || !user.completedProblems.has(titleSlug)) {
    return false;
  }

  const problem = user.completedProblems.get(titleSlug);
  const lastCompletionDate = new Date(problem.lastCompletionDate);
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  return lastCompletionDate > oneDayAgo;
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message);

  if (message.action === 'getUserInfo') {
    console.log('user = ', user);
    getUserInfo(message.shouldRefresh).then((userInfo) => {
      console.log('Sending user info:', userInfo);
      sendResponse(userInfo);
    });
    return true; // This is important for asynchronous response
  } else if (message.action === 'problemCompleted') {
    console.log('Problem completed:', message.data);
    addUserCompletedProblem(message.data);
  } else if (message.action === 'deleteRow') {
    console.log('Deleting row:', message.titleSlug);
    deleteUserCompletedProblem(message.titleSlug);
    sendResponse({ success: true });
  } else if (message.action === 'checkIfProblemCompletedInLastDay') {
    console.log('Checking if problem is already completed:', message.titleSlug);
    sendResponse({
      isCompleted: checkIfProblemCompletedInLastDay(message.titleSlug),
    });
  }
  return true;
});
