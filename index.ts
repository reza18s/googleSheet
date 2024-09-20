import fs from "fs";
import axios from "axios";
import retry from "async-retry";
import { formatISO, parseISO } from "date-fns"; // To manage timestamps
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
interface Data {
  id: number;
  name: string;
  image: string;
  email: string;
  phoneNumber: string;
  postCode: string;
  address: string;
  success: boolean;
  socialId: string | null;
  data: string;
  orderStatus: string | null;
  createdAt: string; // Added createdAt to filter data
}

interface Res {
  data: {
    id: number;
    attributes: {
      name: string;
      image: string;
      email: string;
      postCode: string;
      phoneNumber: string;
      address: string;
      success: boolean;
      socialId: string | null;
      data: string;
      orderStatus: string | null;
      createdAt: string; // Timestamp when the order was created
    };
  }[];
}

const apiClient = axios.create({
  baseURL: process.env.STRAPI_API_URL,
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.STRAPI_KEY}`,
  },
});

const LAST_REQUEST_FILE = "lastRequestTime.json";

// Function to get the last request time from a file
const getLastRequestTime = (): string | null => {
  if (fs.existsSync(LAST_REQUEST_FILE)) {
    const fileContent = fs.readFileSync(LAST_REQUEST_FILE, "utf-8");
    const { lastRequestTime } = JSON.parse(fileContent);
    return lastRequestTime;
  }
  return null;
};

// Function to save the current time as the last request time
const saveLastRequestTime = () => {
  const currentTime = formatISO(new Date());
  fs.writeFileSync(
    LAST_REQUEST_FILE,
    JSON.stringify({ lastRequestTime: currentTime }, null, 2),
  );
};

const getData = async (endpoint: string): Promise<Res> => {
  try {
    const response = await retry(
      async () => {
        return await apiClient.get(endpoint);
      },
      {
        retries: 3,
        onRetry: (error: unknown, attempt: number) => {
          console.warn(`Attempt ${attempt} failed. Retrying...`, error);
        },
      },
    );
    console.log(JSON.stringify(response.data.data[1]));
    return response.data;
  } catch (error) {
    console.error("Error fetching data from Strapi:", error);
    throw new Error(`Failed to fetch data from ${endpoint}`);
  }
};

const postData = async (url: string, data: Data[]): Promise<void> => {
  try {
    const serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const doc = new GoogleSpreadsheet(
      "1v1QZOyAoRmHxHxUsQP2TTWpJS6u3OSbyUy3FNjED5bU",
      serviceAccountAuth,
    );
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    await sheet.addRows(data);
  } catch (error) {
    console.error("Error during POST request:", error);
  }
};

(async () => {
  try {
    const lastRequestTime = getLastRequestTime();

    const res: Res = await getData(
      `api/orders/?sort=createdAt&pagination[pageSize]=${process.env.LIMIT || 100}&pagination[page]=${process.env.PAGE || 1}`,
    );
    const data: Data[] = res.data
      .filter(({ attributes }) => {
        if (!attributes.success) return false;

        // Filter data based on the last request time
        if (lastRequestTime) {
          const createdAt = parseISO(attributes.createdAt);
          const lastTime = parseISO(lastRequestTime);
          return createdAt > lastTime;
        }

        return true;
      })
      .map(({ id, attributes }) => ({
        id,
        name: attributes.name || "",
        image: attributes.image || "",
        email: attributes.email || "",
        phoneNumber: attributes.phoneNumber || "",
        address: attributes.address || "",
        postCode: attributes.postCode || "",
        success: attributes.success,
        socialId: attributes.socialId || null,
        data: attributes.data || "",
        orderStatus: attributes.orderStatus || null,
        createdAt: attributes.createdAt, // Pass createdAt for future reference
      }));

    if (data.length === 0) {
      console.warn("No new successful orders found to post.");
      return;
    }
    await postData(process.env.SHEET_API!, data);

    // Save the current request time after successful data post
    saveLastRequestTime();
  } catch (error) {
    console.error("An error occurred:", error);
  }
})();
