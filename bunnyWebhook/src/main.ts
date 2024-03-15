import { Client, Account, Databases, Query, Permission, Role, Users, Storage, ID, Models } from 'node-appwrite';
import { createHash } from 'node:crypto';
import { File, Blob } from "@web-std/file";

function sha256(content: string) {  
  return createHash('sha256').update(content).digest('hex')
}

const libraryId = "198142";
const cdnHostname = "vz-293d2639-e45.b-cdn.net";

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

/*

{
	"VideoLibraryId": 133,
	"VideoGuid": "657bb740-a71b-4529-a012-528021c31a92",
	"Status": 3
}

-1 - Corey - we reserve this to mark a session and NOT ACTIVE for whatever reason.

0 - Queued: The video has been queued for encoding.
1 - Processing: The video has begun processing the preview and format details.
2 - Encoding: The video is encoding.
3 - Finished: The video encoding has finished and the video is fully available.
4 - Resolution finished: The encoder has finished processing one of the resolutions. The first request also signals that the video is now playable.
5 - Failed: The video encoding failed. The video has finished processing.
6 - PresignedUploadStarted : A pre-signed upload has been initiated.
7 - PresignedUploadFinished : A pre-signed upload has been completed.
8 - PresignedUploadFailed : A pre-signed upload has failed.
9 - CaptionsGenerated : Automatic captions were generated.
10 - TitleOrDescriptionGenerated : Automatic generation of title or description has been completed.
*/

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
      const jsonPayload = req.body;
      log(`jsonPayload: ${jsonPayload}`);
      
      const client = new Client()
        .setEndpoint('https://cloud.appwrite.io/v1')
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
        .setKey(process.env.APPWRITE_API_KEY!);

      if(jsonPayload.VideoGuid){
        const db = new Databases(client);
        log("Looking up session by video id: " + jsonPayload.VideoGuid)
        const {documents} = await db.listDocuments(
          process.env.APPWRITE_DATABASE_ID!,
          "session",
          [
            Query.equal("videoId",jsonPayload.VideoGuid)
          ]
        );
        if(documents.length === 0)throw Error(`No session with video id ${jsonPayload.VideoGuid} can be found`)
        const session = documents[0];
        // update the status ...
        await db.updateDocument(
          process.env.APPWRITE_DATABASE_ID!,
          "session",
          session.$id,
          {
            videoEncodingStatus: jsonPayload.Status
          }
        );
        // if the video is finished.. lets grab any media that we need.
        if(jsonPayload.Status === 3){
          log("video finished.. grabbing thumb")
          const videoLibraryId = jsonPayload.VideoLibraryId;
          const videoGuid = jsonPayload.VideoGuid;
          // create the video
          const url = `https://video.bunnycdn.com/library/${videoLibraryId}/videos/${videoGuid}`;
          log("About to get video at url: " + url);
          log(process.env.BUNNY_API_KEY!);
          const options: RequestInit = {
            method: 'GET',
            headers: {
              accept: 'application/json',
              'content-type': 'application/*+json',
              AccessKey: process.env.BUNNY_API_KEY!
            }      
          };
          const video = await fetch(url, options).then(res => res.json());
          log(`Fetched video: ${JSON.stringify(video)}`);
          // thumb eg:
          // https://vz-293d2639-e45.b-cdn.net/{videoId}/thumb.jpg
          // https://vz-293d2639-e45.b-cdn.net/965db558-ed2a-426b-a3ba-925fed052760/thumbnail.jpg
          const thumbUrl = `https://${cdnHostname}/${videoGuid}/${video.thumbnailFileName}`
          const fileResonse: Models.File = await fetch(thumbUrl).then(async response => {
            const blob = await response.blob();
            const file = new File([blob], video.thumbnailFileName) 
            const storage = new Storage(client);        
            return storage.createFile(
              "profile_pics",
              ID.unique(),
              file,
              [
                Permission.read(Role.any()),
                Permission.write(Role.user(session.$id)),
                Permission.update(Role.user(session.$id)),
                Permission.delete(Role.user(session.$id)),
              ],
            );
          });
          log("fileResonse: " + JSON.stringify(fileResonse));
          await db.updateDocument(
            process.env.APPWRITE_DATABASE_ID!,
            "session",
            session.$id,
            {
              coverImgId: fileResonse.$id
            }
          );
          log("thumbnail updated");
        }
      log("done.")        
      }else{
        throw Error("No video Id in webhook request.")
      }
      return res.send("");    
  }catch(e:any) {
    error(e);
    throw e;
  }
};
