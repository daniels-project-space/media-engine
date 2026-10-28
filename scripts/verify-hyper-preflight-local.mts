import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
process.loadEnvFile('.env.local');
assert.equal(new URL(process.env.NEXT_PUBLIC_CONVEX_URL!).hostname,'127.0.0.1');
assert.equal(process.env.VAULT_ACCESS_TOKEN, undefined, 'This test requires an isolated local app without a vault credential');
const client=new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const gateway=makeFunctionReference<'action'>('marketingGateway:call');
const call=(operation:string,payload:unknown)=>client.action(gateway,{serviceToken:process.env.MEDIA_ENGINE_CONVEX_SERVICE_TOKEN!,operation,payload});
const workspace=await call('listWorkspace',{}) as {projects:Array<{_id:string;name:string}>};
let target:{projectId:string;brief:{_id:string;modelId:string;format:string;channel:string}}|undefined;
for(const project of workspace.projects.filter(p=>p.name.startsWith('Local plan '))){
 const briefs=await call('listRenderBriefs',{projectId:project._id}) as Array<{_id:string;modelId:string;format:string;channel:string}>;
 if(briefs.length){target={projectId:project._id,brief:briefs[0]};break;}
}
assert(target,'No private local fixture with a render brief found');
const other=workspace.projects.find(p=>p._id!==target!.projectId);assert(other);
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
 const context=await browser.newContext({baseURL:'http://localhost:3108',viewport:{width:390,height:844}});
 const session=await context.request.post('/api/operator/session',{headers:{authorization:`Bearer ${process.env.MEDIA_ENGINE_OPERATOR_TOKEN!}`},data:{}});assert.equal(session.status(),200);
 const page=await context.newPage();await page.goto('/marketing#projects');
 await page.getByRole('combobox',{name:'Current project'}).selectOption(target.projectId);
 const card=page.locator('details').filter({has:page.locator('summary').filter({hasText:target.brief.modelId})}).last();
 await card.locator('summary').click();await card.getByRole('button',{name:'Check render readiness'}).click();
 await expect(card.getByText(/Project connection status is unavailable/)).toBeVisible({timeout:20000});
 await expect(card.getByText(/No GPU job was submitted/)).toBeVisible();
 const query=new URLSearchParams({projectId:target.projectId,briefId:target.brief._id});
 const response=await context.request.get(`/api/marketing/hyper-preflight?${query}`);assert.equal(response.status(),200);
 const body=await response.json();assert.equal(body.dispatchEnabled,false);assert.equal(body.monetaryCapVerified,false);assert.equal(body.capacityVerified,false);assert.equal(body.projectConnection,'unavailable');
 const foreign=new URLSearchParams({projectId:other._id,briefId:target.brief._id});
 assert.equal((await context.request.get(`/api/marketing/hyper-preflight?${foreign}`)).status(),400);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'/root/media-engine-marketing-proof-20261028/local-hyper-preflight-mobile.png',fullPage:true});
 console.log(JSON.stringify({localPreflight:true,crossProjectRejected:true,noDispatch:true,mobileFits:true}));
} finally {await browser.close();}
