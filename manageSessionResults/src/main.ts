import { Client, Account, Databases, Query, ID, Permission, Role, Models } from 'node-appwrite';
import { connect } from 'getstream';

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
    'STREAM_API_KEY',
    'STREAM_API_SECRET',
    'STREAM_APP_ID',
  ]);
    try{
       // The `req` object contains the request data
       if (req.method === 'GET') {
        // Send a response with the res object helpers
        // `res.send()` dispatches a string back to the client
        return res.error('expected POST, DELETE');
      }
      log(req.body);
      const jsonPayload = JSON.parse(req.body);
      const jwtToken = jsonPayload.jwtToken;      
      if(!jwtToken)throw new Error("No JWT token in request body");
      
      
      const userClient = new Client()
        .setEndpoint('https://cloud.appwrite.io/v1')
        .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
        .setJWT(jwtToken);

      const userAccount = new Account(userClient);

      const userId = (await userAccount.get()).$id;
      if(!userId)throw new Error("No user found from JWT token");
      log(`got userId: ${userId}`);      

      const client = new Client()
          .setEndpoint('https://cloud.appwrite.io/v1')
          .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID!)
          .setKey(process.env.APPWRITE_API_KEY!);

      const db = new Databases(client);

      if (req.method === 'PUT') {        
        log(`create`);
        const programId = jsonPayload.programId;
        if(!programId)throw new Error("No programId in request body");
        const sessionId = jsonPayload.sessionId;
        if(!sessionId)throw new Error("No sessionId in request body");
        const sessionResult = await db.createDocument(
              process.env.APPWRITE_DATABASE_ID!,
              "session_result",
              ID.unique(),
              {
                "userKey": userId,
                "sessionKey": sessionId,
                "session": sessionId,
                "profile": userId,
                "programKey": programId,
                "startTimeMs": Date.now(),
              },
              [
                Permission.read(Role.users()),        
                Permission.update(Role.team("admin")),
                Permission.delete(Role.team("admin")),
                Permission.delete(Role.user(userId)),
                Permission.update(Role.user(userId)),            
            ]
          );
          log("sessionResult: " + JSON.stringify(sessionResult));
          return res.send(sessionResult.$id);
      }
      if (req.method === 'POST') {
        const sessionResultId = jsonPayload.sessionResultId;
        if(!sessionResultId)throw new Error("No sessionResultId in request body");
        const document = await db.getDocument(
          process.env.APPWRITE_DATABASE_ID!,
          "session_result",
          sessionResultId         
        );
        if(!document){
          throw Error("No session result found");
        }
        if((document as any).userKey !== userId){
          throw Error("This session result is not owned by the user: " + userId);
        }
        log(`update`);
        const sessionResult = await db.updateDocument(
          process.env.APPWRITE_DATABASE_ID!,
          "session_result",
          sessionResultId,
          {
            "endTimeMs": Date.now(),           
          }        
        );
        log("sessionResult: " + JSON.stringify(sessionResult))
        await db.updateDocument(process.env.APPWRITE_DATABASE_ID!,
          "session",
          (sessionResult as any).session.$id, {
            views: ((sessionResult as any).session.views + 1),
          });              
        log("sessionResult: " + JSON.stringify(sessionResult));
        // - update the profile stats
        const profileStats: Models.Document = await db.getDocument(process.env.APPWRITE_DATABASE_ID!,
          "profile_stats",
          userId
          ).catch((r) => db.createDocument(process.env.APPWRITE_DATABASE_ID!,
            "profile_stats",
            userId,
            { // don't fail just create one if we can not find the record.
              totalTimeMs: 0,
              totalNumSessions: 0,
              totalMindPoints: 0,
              totalBodyPoints: 0,
              totalSoulPoints: 0,
            }  
          ));
        
        // now update the stat totals...
        const [mindPoints, bodyPoints, soulPoints] = (document as any).session.mbsPoints.length === 3 ? (document as any).session.mbsPoints : [0,0,0];
        db.updateDocument(process.env.APPWRITE_DATABASE_ID!,
          "profile_stats",
          userId,
          {
            totalTimeMs: (profileStats as any).totalTimeMs + (document as any).session.totalLengthMs,
            totalNumSessions: (profileStats as any).totalNumSessions + 1,
            totalMindPoints: (profileStats as any).totalMindPoints + mindPoints,
            totalBodyPoints: (profileStats as any).totalBodyPoints + bodyPoints,
            totalSoulPoints: (profileStats as any).totalSoulPoints + soulPoints,
          });      
        // - Also post the result to the sessions timeline
        const client = connect(process.env.STREAM_API_KEY!, process.env.STREAM_API_SECRET!, process.env.STREAM_APP_ID!);
        const sessionFeed = client.feed('session_activity', (sessionResult as any).sessionKey );
        // Create an activity object
        const activity = { actor: `SU:${userId}`, verb: 'scored', object: `SessionResult:${(sessionResult as any).$id}`, foreign_id:(sessionResult as any).sessionKey, time: sessionResult.$createdAt, extra_data: sessionResult };
        // Add an activity to the feed
        await sessionFeed.addActivity(activity);

        // - Post the result to the users feed (and timeline)
        const userFeed = client.feed('user', userId);
        await userFeed.addActivity(activity);
        const timelineFeed = client.feed('timeline', userId);
        await timelineFeed.addActivity(activity);

        const programId = (sessionResult as any).programKey;
        // - Post result to the program feed and program aggregation feed.
        const programAggregated = client.feed('program_aggregated', programId);
        await programAggregated.addActivity(activity);
        const programActivity = client.feed('program_activity', programId);
        await programActivity.addActivity(activity);
        log("posting activity to feed: [session_activity, user, timeline, program_aggregated, program_activity]");
        log("activity: " + JSON.stringify(activity));
        return res.send(sessionResult.$id);               
      }
      if (req.method === 'DELETE') {
        // TODO: ..
      }    
  }catch(e:any) {
    error(e);
    throw e;
  }
};
