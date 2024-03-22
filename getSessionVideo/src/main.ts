import { Client, Account, Databases, Query, Permission, Role, Users } from 'node-appwrite';
import { createHash } from 'node:crypto';

function sha256(content: string) {  
  return createHash('sha256').update(content).digest('hex')
}

const libraryId = "198142";

function throwIfMissing(obj: any, keys: string[]): void {
  const missing: string[] = [];
  for (let key of keys) {
    if (!(key in obj) || !obj[key]) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }
}

type Context = {
  req: any;
  res: any;
  log: (msg: any) => void;
  error: (msg: any) => void;
};

// This is your Appwrite function
// It's executed each time we get a request
export default async ({ req, res, log, error }: Context) => {
  throwIfMissing(process.env, [
    'APPWRITE_API_KEY',
    'APPWRITE_FUNCTION_PROJECT_ID',
    'APPWRITE_DATABASE_ID',
    'BUNNY_API_KEY',
    'BUNNY_STREAM_API_KEY',
  ]);
    try{     
      log(req.body);
      const jsonPayload = JSON.parse(req.body);
      const jwtToken = jsonPayload.jwtToken;
      if(!jwtToken)throw new Error("No JWT token in request body");          
      
      const userClient = new Client()
        .setEndpoint('https://cloud.appwrite.io/v1')
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
        .setJWT(jwtToken);

      const userAccount = new Account(userClient);                

      if(req.method == 'PUT'){
        // check that we are an instructor for this course?
        const programId = jsonPayload.programId;
        if(!programId)throw new Error("No program ID was in the request body.");
        const userId = (await userAccount.get()).$id;        
        if(!userId)throw new Error("Could not resolve user from jwt.");
        const title = jsonPayload.title;
        if(!title)throw new Error("No title was in the request body.");
       
        const client = new Client()
          .setEndpoint('https://cloud.appwrite.io/v1')
          .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
          .setKey(process.env.APPWRITE_API_KEY!);
        const db = new Databases(client)
        const program = await db.getDocument(process.env.APPWRITE_DATABASE_ID!,
          "program",
          programId);
        log(`Got program: ${JSON.stringify(program)}`);
        const instructor = (program as any).instructor.profile as [];
        if(!instructor.find( (p: any) => p.$id === userId))throw new Error(`User: ${userId} is not an instructor for this program`);

        log("About to create video: " + JSON.stringify({
          title,
          collectionId: programId
        }));      
        
        const collectionUrl = `https://video.bunnycdn.com/library/${libraryId}/collections?search=${search}`;
        const collectionPptions: RequestInit = {
          method: 'GET',
          headers: {
            accept: 'application/json',
            'content-type': 'application/*+json',
            AccessKey: process.env.BUNNY_API_KEY!
          }       
        };
        const collections = await fetch(collectionUrl, collectionPptions).then(res => res.json()).catch((err) => {
          // don't fail if for some reason we don't find the collection
          log("WARNING could not find a video colleciton with name: " + programId);
        });
        const collection = collections.items.find((c: any) => c.guid);
        log("Found video collection: " + JSON.stringify(collection));

        // create the video
        const url = `https://video.bunnycdn.com/library/${libraryId}/videos`;
        const options: RequestInit = {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/*+json',
            AccessKey: process.env.BUNNY_API_KEY!
          },
          body: JSON.stringify({
            title,
            collectionId: collection?.guid,
          })
        };
        const video = await fetch(url, options).then(res => res.json());
        log(`Created video: ${JSON.stringify(video)}`);

        // Pass back the secure upload link
        // UNIX timestamp when the vidoe link will expire (default to 1 day)
        const timestamp = Math.round( (Date.now() + (24 * 60 * 60 * 1000)) / 1000 );  // UNIX POSIX is in seconds not ms.
        //sha256(library_id + api_key + expiration_time + video_id)
        const hash = sha256(libraryId + process.env.BUNNY_API_KEY! + timestamp + video.guid);
        return res.json({
          hash,
          timestamp,
          videoId: video.guid,
          libraryId,
        });
      }

      if (req.method == 'GET') {      
        const videoId = jsonPayload.videoId;
        if(!videoId)throw new Error("No video ID was in the request body.");   

        // UNIX timestamp when the vidoe link will expire (default to 120 minutes)
        const timestamp = Math.round( (Date.now() + (120 * 60 * 1000)) / 1000 );  // UNIX POSIX is in seconds not ms.
        log("Bunny: "+process.env.BUNNY_STREAM_API_KEY!);
        log("Video: "+videoId);
        log("timestamp: "+timestamp);

        //const test = sha256("4742a81b-bf15-42fe-8b1c-8fcb9024c550" + "32d140e2-e4f4-4eec-9d53-20371e9be607" + timestamp);
        //log("titestmestamp: "+test);

        const hash = sha256(process.env.BUNNY_STREAM_API_KEY! + videoId + timestamp);
        return res.json({
          hash,
          timestamp,
          videoId,
          libraryId,
        });
      }

      return res.error("Function called with wrong METHOD");
  }catch(e:any) {
    error(e);
    throw e;
  }
};
