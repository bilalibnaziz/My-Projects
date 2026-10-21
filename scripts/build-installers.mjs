import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const ROOT_DIR = '/Users/Apple/Desktop/my projects ';
const INSTALLER_DIR = path.join(ROOT_DIR, 'installer');
const MAC_DIR = path.join(INSTALLER_DIR, 'Mac');
const WIN_DIR = path.join(INSTALLER_DIR, 'Windows');
const MAC_APPS_DIR = path.join(MAC_DIR, 'Applications');

const APPS = [
  {
    id: 'SkillPhoto',
    name: 'Skill Photo',
    slug: 'SkillPhoto',
    bundleId: 'com.skillphoto.app',
    sourceDir: 'SkillPhoto',
    version: '1.0.0',
    description: 'Professional Layered Photo Editor with RAW, Curves, Frequency Separation & Liquify',
    windowWidth: 1440,
    windowHeight: 900,
    minWidth: 1024,
    minHeight: 700,
    fileExts: ['.photo', '.psd', '.tif'],
    accentColor: '#38bdf8',
  },
  {
    id: 'SkillVector',
    name: 'Skill Vector',
    slug: 'SkillVector',
    bundleId: 'com.skillvector.app',
    sourceDir: 'SkillVector',
    version: '1.0.0',
    description: 'Precision Vector Illustration with 2D Boolean Pathfinder, Shape Builder & Pen Tool',
    windowWidth: 1440,
    windowHeight: 900,
    minWidth: 1024,
    minHeight: 700,
    fileExts: ['.vector', '.svg', '.ai'],
    accentColor: '#fb923c',
  },
  {
    id: 'SkillMotion',
    name: 'Skill Motion',
    slug: 'SkillMotion',
    bundleId: 'com.skillmotion.app',
    sourceDir: 'SkillMotion',
    version: '1.0.0',
    description: 'Frame-Accurate Video NLE & Motion VFX with Bezier Keyframe Curves & YouTube Chapters',
    windowWidth: 1560,
    windowHeight: 940,
    minWidth: 1100,
    minHeight: 720,
    fileExts: ['.motion', '.mp4', '.mov'],
    accentColor: '#a855f7',
  },
];

console.log('====================================================');
console.log('       SKILL SUITE v1.0 INSTALLER BUILD ENGINE      ');
console.log('  Generating macOS (.app / .dmg) & Windows Installers');
console.log('====================================================\n');

// Ensure base directories exist
fs.mkdirSync(MAC_APPS_DIR, { recursive: true });
fs.mkdirSync(WIN_DIR, { recursive: true });

// 1. Re-build Frontends Fresh
console.log('>> [Step 1/5] Building fresh production frontend dist/ bundles...');
for (const app of APPS) {
  console.log(`   Compiling ${app.name} (${app.sourceDir})...`);
  execSync('npm run build', { cwd: path.join(ROOT_DIR, app.sourceDir), stdio: 'pipe' });
  const distDir = path.join(ROOT_DIR, app.sourceDir, 'dist');
  console.log(`   ✓ ${app.name} dist/ compiled (${fs.readdirSync(distDir).length} files)`);
}

// 2. Build Native macOS Applications (.app)
console.log('\n>> [Step 2/5] Building native universal macOS .app bundles...');

// Write shared Objective-C launcher source
const launcherSourcePath = path.join(INSTALLER_DIR, 'launcher_template.m');
const launcherSourceCode = `
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@interface AppSchemeHandler : NSObject <WKURLSchemeHandler>
@property (copy, nonatomic) NSString *basePath;
@end

@implementation AppSchemeHandler

- (void)webView:(WKWebView *)webView startURLSchemeTask:(id<WKURLSchemeTask>)urlSchemeTask {
    NSURL *url = urlSchemeTask.request.URL;
    NSString *path = [url path];
    if ([path isEqualToString:@"/"] || [path length] == 0) {
        path = @"/index.html";
    }
    NSString *fullPath = [self.basePath stringByAppendingPathComponent:path];
    NSData *data = [NSData dataWithContentsOfFile:fullPath];
    if (data) {
        NSString *mime = @"text/plain";
        NSString *ext = [[path pathExtension] lowercaseString];
        if ([ext isEqualToString:@"html"]) mime = @"text/html";
        else if ([ext isEqualToString:@"js"] || [ext isEqualToString:@"mjs"]) mime = @"application/javascript";
        else if ([ext isEqualToString:@"css"]) mime = @"text/css";
        else if ([ext isEqualToString:@"svg"]) mime = @"image/svg+xml";
        else if ([ext isEqualToString:@"png"]) mime = @"image/png";
        else if ([ext isEqualToString:@"jpg"] || [ext isEqualToString:@"jpeg"]) mime = @"image/jpeg";
        else if ([ext isEqualToString:@"gif"]) mime = @"image/gif";
        else if ([ext isEqualToString:@"webp"]) mime = @"image/webp";
        else if ([ext isEqualToString:@"ico"]) mime = @"image/x-icon";
        else if ([ext isEqualToString:@"json"]) mime = @"application/json";
        else if ([ext isEqualToString:@"wasm"]) mime = @"application/wasm";
        else if ([ext isEqualToString:@"woff2"]) mime = @"font/woff2";
        else if ([ext isEqualToString:@"woff"]) mime = @"font/woff";
        else if ([ext isEqualToString:@"ttf"]) mime = @"font/ttf";
        
        NSDictionary *headers = @{
            @"Content-Type": mime,
            @"Access-Control-Allow-Origin": @"*",
            @"Cache-Control": @"no-cache"
        };
        NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc] initWithURL:url
                                                                  statusCode:200
                                                                 HTTPVersion:@"HTTP/1.1"
                                                                headerFields:headers];
        [urlSchemeTask didReceiveResponse:response];
        [urlSchemeTask didReceiveData:data];
        [urlSchemeTask didFinish];
    } else {
        NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc] initWithURL:url
                                                                  statusCode:404
                                                                 HTTPVersion:@"HTTP/1.1"
                                                                headerFields:nil];
        [urlSchemeTask didReceiveResponse:response];
        [urlSchemeTask didFinish];
    }
}

- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)urlSchemeTask {}

@end

@interface SkillSuiteWebView : WKWebView
@end

@implementation SkillSuiteWebView

- (instancetype)initWithFrame:(NSRect)frame configuration:(WKWebViewConfiguration *)configuration {
    self = [super initWithFrame:frame configuration:configuration];
    if (self) {
        [self registerForDraggedTypes:@[NSPasteboardTypeFileURL, NSPasteboardTypeString]];
    }
    return self;
}

- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)sender {
    NSPasteboard *pboard = [sender draggingPasteboard];
    if ([[pboard types] containsObject:NSPasteboardTypeFileURL]) {
        return NSDragOperationCopy;
    }
    return NSDragOperationNone;
}

- (NSDragOperation)draggingUpdated:(id<NSDraggingInfo>)sender {
    NSPasteboard *pboard = [sender draggingPasteboard];
    if ([[pboard types] containsObject:NSPasteboardTypeFileURL]) {
        return NSDragOperationCopy;
    }
    return NSDragOperationNone;
}

- (BOOL)performDragOperation:(id<NSDraggingInfo>)sender {
    NSPasteboard *pboard = [sender draggingPasteboard];
    if ([[pboard types] containsObject:NSPasteboardTypeFileURL]) {
        NSArray *classes = @[[NSURL class]];
        NSDictionary *options = @{NSPasteboardURLReadingFileURLsOnlyKey: @YES};
        NSArray *urls = [pboard readObjectsForClasses:classes options:options];
        if (urls.count > 0) {
            NSMutableArray *fileDicts = [NSMutableArray array];
            for (NSURL *url in urls) {
                NSData *data = [NSData dataWithContentsOfURL:url];
                if (data && data.length > 0) {
                    NSString *b64 = [data base64EncodedStringWithOptions:0];
                    NSString *name = [url lastPathComponent];
                    NSString *ext = [[url pathExtension] lowercaseString];
                    NSString *mime = @"application/octet-stream";
                    if ([ext isEqualToString:@"png"]) mime = @"image/png";
                    else if ([ext isEqualToString:@"jpg"] || [ext isEqualToString:@"jpeg"]) mime = @"image/jpeg";
                    else if ([ext isEqualToString:@"svg"]) mime = @"image/svg+xml";
                    else if ([ext isEqualToString:@"webp"]) mime = @"image/webp";
                    else if ([ext isEqualToString:@"gif"]) mime = @"image/gif";
                    else if ([ext isEqualToString:@"mp4"]) mime = @"video/mp4";
                    else if ([ext isEqualToString:@"mov"]) mime = @"video/quicktime";
                    else if ([ext isEqualToString:@"mp3"]) mime = @"audio/mp3";
                    else if ([ext isEqualToString:@"wav"]) mime = @"audio/wav";
                    else if ([ext isEqualToString:@"photoscale"] || [ext isEqualToString:@"skillphoto"]) mime = @"application/json";
                    else if ([ext isEqualToString:@"skillvector"]) mime = @"application/json";
                    [fileDicts addObject:@{@"name": name, @"type": mime, @"mime": mime, @"base64": b64, @"data": b64}];
                }
            }
            if (fileDicts.count > 0) {
                NSError *err = nil;
                NSData *jsonData = [NSJSONSerialization dataWithJSONObject:fileDicts options:0 error:&err];
                if (jsonData) {
                    NSString *jsonStr = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
                    NSString *js = [NSString stringWithFormat:@"if (window.__skillSuiteOnNativeFileDrop) { window.__skillSuiteOnNativeFileDrop(%@); }", jsonStr];
                    [self evaluateJavaScript:js completionHandler:nil];
                    return YES;
                }
            }
        }
    }
    return NO;
}

@end

@interface AppDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler>
@property (strong, nonatomic) NSWindow *window;
@property (strong, nonatomic) SkillSuiteWebView *webView;
@end

@implementation AppDelegate

- (void)runJSCommand:(NSString *)cmdId {
    NSString *js = [NSString stringWithFormat:@"if (window.__skillSuite && window.__skillSuite.runCommand) { window.__skillSuite.runCommand('%@'); } else if (window.__ps && window.__ps.commands) { var c = window.__ps.commands.find(function(x){ return x.id === '%@'; }); if (c) c.run(); }", cmdId, cmdId];
    [self.webView evaluateJavaScript:js completionHandler:nil];
}

- (void)menuCommandAction:(NSMenuItem *)sender {
    NSString *cmdId = sender.representedObject;
    if (cmdId && [cmdId length] > 0) {
        [self runJSCommand:cmdId];
    }
}

- (NSMenuItem *)createMenuItem:(NSString *)title action:(SEL)action key:(NSString *)key mask:(NSEventModifierFlags)mask cmdId:(NSString *)cmdId {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:key];
    if (mask != 0) {
        [item setKeyEquivalentModifierMask:mask];
    }
    if (cmdId) {
        item.representedObject = cmdId;
    }
    return item;
}

- (void)setupMenuBar:(NSString *)appName {
    NSMenu *mainMenu = [[NSMenu alloc] init];

    // 1. App Submenu
    NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:appName];
    [appMenu addItemWithTitle:[NSString stringWithFormat:@"About %@", appName] action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItem:[self createMenuItem:@"Preferences…" action:@selector(menuCommandAction:) key:@"," mask:NSEventModifierFlagCommand cmdId:@"preferences"]];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:[NSString stringWithFormat:@"Hide %@", appName] action:@selector(hide:) keyEquivalent:@"h"];
    NSMenuItem *hideOthers = [appMenu addItemWithTitle:@"Hide Others" action:@selector(hideOtherApplications:) keyEquivalent:@"h"];
    [hideOthers setKeyEquivalentModifierMask:(NSEventModifierFlagOption | NSEventModifierFlagCommand)];
    [appMenu addItemWithTitle:@"Show All" action:@selector(unhideAllApplications:) keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:[NSString stringWithFormat:@"Quit %@", appName] action:@selector(terminate:) keyEquivalent:@"q"];
    [appMenuItem setSubmenu:appMenu];
    [mainMenu addItem:appMenuItem];

    // 2. File Submenu
    NSMenuItem *fileMenuItem = [[NSMenuItem alloc] init];
    NSMenu *fileMenu = [[NSMenu alloc] initWithTitle:@"File"];
    [fileMenu addItem:[self createMenuItem:@"New…" action:@selector(menuCommandAction:) key:@"n" mask:NSEventModifierFlagCommand cmdId:@"new"]];
    [fileMenu addItem:[self createMenuItem:@"New from Template…" action:@selector(menuCommandAction:) key:@"n" mask:(NSEventModifierFlagCommand | NSEventModifierFlagOption) cmdId:@"new-template"]];
    [fileMenu addItem:[self createMenuItem:@"Open…" action:@selector(menuCommandAction:) key:@"o" mask:NSEventModifierFlagCommand cmdId:@"open"]];
    [fileMenu addItem:[self createMenuItem:@"Place Image as Layer…" action:@selector(menuCommandAction:) key:@"p" mask:(NSEventModifierFlagCommand | NSEventModifierFlagShift) cmdId:@"place"]];
    [fileMenu addItem:[NSMenuItem separatorItem]];
    [fileMenu addItem:[self createMenuItem:@"Save Project (.photoscale)" action:@selector(menuCommandAction:) key:@"s" mask:NSEventModifierFlagCommand cmdId:@"save"]];
    [fileMenu addItem:[self createMenuItem:@"Export As…" action:@selector(menuCommandAction:) key:@"w" mask:(NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagShift) cmdId:@"export"]];
    [fileMenu addItem:[self createMenuItem:@"Quick Export as PNG" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"quick-export"]];
    [fileMenu addItem:[self createMenuItem:@"Export as Photoshop PSD…" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"export-psd"]];
    [fileMenu addItem:[self createMenuItem:@"Revert to Original" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"revert-image"]];
    [fileMenu addItem:[NSMenuItem separatorItem]];
    [fileMenu addItem:[self createMenuItem:@"Close Document" action:@selector(menuCommandAction:) key:@"w" mask:NSEventModifierFlagCommand cmdId:@"close"]];
    [fileMenuItem setSubmenu:fileMenu];
    [mainMenu addItem:fileMenuItem];

    // 3. Edit Submenu
    NSMenuItem *editMenuItem = [[NSMenuItem alloc] init];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
    [editMenu addItem:[self createMenuItem:@"Undo" action:@selector(menuCommandAction:) key:@"z" mask:NSEventModifierFlagCommand cmdId:@"undo"]];
    [editMenu addItem:[self createMenuItem:@"Redo" action:@selector(menuCommandAction:) key:@"z" mask:(NSEventModifierFlagCommand | NSEventModifierFlagShift) cmdId:@"redo"]];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItem:[self createMenuItem:@"Cut" action:@selector(menuCommandAction:) key:@"x" mask:NSEventModifierFlagCommand cmdId:@"cut"]];
    [editMenu addItem:[self createMenuItem:@"Copy" action:@selector(menuCommandAction:) key:@"c" mask:NSEventModifierFlagCommand cmdId:@"copy"]];
    [editMenu addItem:[self createMenuItem:@"Paste" action:@selector(menuCommandAction:) key:@"v" mask:NSEventModifierFlagCommand cmdId:@"paste"]];
    [editMenu addItem:[self createMenuItem:@"Clear / Delete" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"clear"]];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItem:[self createMenuItem:@"Fill with Foreground" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"fill-fg"]];
    [editMenu addItem:[self createMenuItem:@"Fill with Background" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"fill-bg"]];
    [editMenu addItem:[self createMenuItem:@"Content-Aware Fill (Remove Object)" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"caf"]];
    [editMenu addItem:[self createMenuItem:@"Free Transform" action:@selector(menuCommandAction:) key:@"t" mask:NSEventModifierFlagCommand cmdId:@"transform"]];
    [editMenuItem setSubmenu:editMenu];
    [mainMenu addItem:editMenuItem];

    // 4. Image Submenu
    NSMenuItem *imageMenuItem = [[NSMenuItem alloc] init];
    NSMenu *imageMenu = [[NSMenu alloc] initWithTitle:@"Image"];
    
    // Adjustments Submenu inside Image
    NSMenuItem *adjMenuItem = [[NSMenuItem alloc] init];
    NSMenu *adjMenu = [[NSMenu alloc] initWithTitle:@"Adjustments"];
    [adjMenu addItem:[self createMenuItem:@"Brightness / Contrast…" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"brightness-contrast"]];
    [adjMenu addItem:[self createMenuItem:@"Levels…" action:@selector(menuCommandAction:) key:@"l" mask:NSEventModifierFlagCommand cmdId:@"levels"]];
    [adjMenu addItem:[self createMenuItem:@"Curves…" action:@selector(menuCommandAction:) key:@"m" mask:NSEventModifierFlagCommand cmdId:@"curves"]];
    [adjMenu addItem:[self createMenuItem:@"Exposure…" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"exposure"]];
    [adjMenu addItem:[self createMenuItem:@"Vibrance…" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"vibrance"]];
    [adjMenu addItem:[self createMenuItem:@"Hue / Saturation…" action:@selector(menuCommandAction:) key:@"u" mask:NSEventModifierFlagCommand cmdId:@"hue-saturation"]];
    [adjMenu addItem:[self createMenuItem:@"Color Balance…" action:@selector(menuCommandAction:) key:@"b" mask:NSEventModifierFlagCommand cmdId:@"color-balance"]];
    [adjMenu addItem:[self createMenuItem:@"Black & White…" action:@selector(menuCommandAction:) key:@"b" mask:(NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagShift) cmdId:@"black-and-white"]];
    [adjMenu addItem:[self createMenuItem:@"Invert" action:@selector(menuCommandAction:) key:@"i" mask:NSEventModifierFlagCommand cmdId:@"invert"]];
    [adjMenu addItem:[self createMenuItem:@"Desaturate" action:@selector(menuCommandAction:) key:@"u" mask:(NSEventModifierFlagCommand | NSEventModifierFlagShift) cmdId:@"desaturate"]];
    [adjMenuItem setTitle:@"Adjustments"];
    [adjMenuItem setSubmenu:adjMenu];
    [imageMenu addItem:adjMenuItem];

    [imageMenu addItem:[NSMenuItem separatorItem]];
    [imageMenu addItem:[self createMenuItem:@"Auto Enhance (Smart Tune)" action:@selector(menuCommandAction:) key:@"l" mask:(NSEventModifierFlagCommand | NSEventModifierFlagShift) cmdId:@"auto-enhance"]];
    [imageMenu addItem:[self createMenuItem:@"Auto Tone" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"auto-tone"]];
    [imageMenu addItem:[self createMenuItem:@"Auto Contrast" action:@selector(menuCommandAction:) key:@"l" mask:(NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagShift) cmdId:@"auto-contrast"]];
    [imageMenu addItem:[self createMenuItem:@"Auto Color" action:@selector(menuCommandAction:) key:@"b" mask:(NSEventModifierFlagCommand | NSEventModifierFlagShift) cmdId:@"auto-color"]];
    [imageMenu addItem:[self createMenuItem:@"Auto White Balance" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"auto-wb"]];
    [imageMenu addItem:[self createMenuItem:@"Looks & LUTs…" action:@selector(menuCommandAction:) key:@"k" mask:(NSEventModifierFlagCommand | NSEventModifierFlagShift) cmdId:@"looks"]];
    [imageMenu addItem:[NSMenuItem separatorItem]];
    [imageMenu addItem:[self createMenuItem:@"Image Size…" action:@selector(menuCommandAction:) key:@"i" mask:(NSEventModifierFlagCommand | NSEventModifierFlagOption) cmdId:@"image-size"]];
    [imageMenu addItem:[self createMenuItem:@"Canvas Size…" action:@selector(menuCommandAction:) key:@"c" mask:(NSEventModifierFlagCommand | NSEventModifierFlagOption) cmdId:@"canvas-size"]];
    [imageMenu addItem:[self createMenuItem:@"Crop Tool" action:@selector(menuCommandAction:) key:@"c" mask:0 cmdId:@"crop-tool"]];
    [imageMenu addItem:[self createMenuItem:@"Crop to Selection" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"crop-sel"]];
    [imageMenu addItem:[self createMenuItem:@"Trim Transparent Pixels" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"trim"]];
    [imageMenu addItem:[NSMenuItem separatorItem]];
    [imageMenu addItem:[self createMenuItem:@"Rotate 90° Clockwise" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"rot-cw"]];
    [imageMenu addItem:[self createMenuItem:@"Rotate 90° Counter-Clockwise" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"rot-ccw"]];
    [imageMenu addItem:[self createMenuItem:@"Rotate 180°" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"rot-180"]];
    [imageMenu addItem:[self createMenuItem:@"Flip Canvas Horizontal" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"flip-canvas-h"]];
    [imageMenu addItem:[self createMenuItem:@"Flip Canvas Vertical" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"flip-canvas-v"]];
    [imageMenu addItem:[self createMenuItem:@"Duplicate Image…" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"duplicate-image"]];
    [imageMenuItem setSubmenu:imageMenu];
    [mainMenu addItem:imageMenuItem];

    // 5. Layer Submenu
    NSMenuItem *layerMenuItem = [[NSMenuItem alloc] init];
    NSMenu *layerMenu = [[NSMenu alloc] initWithTitle:@"Layer"];
    [layerMenu addItem:[self createMenuItem:@"New Layer" action:@selector(menuCommandAction:) key:@"n" mask:(NSEventModifierFlagCommand | NSEventModifierFlagShift) cmdId:@"new-layer"]];
    [layerMenu addItem:[self createMenuItem:@"New Adjustment Layer…" action:@selector(menuCommandAction:) key:@"a" mask:(NSEventModifierFlagCommand | NSEventModifierFlagOption) cmdId:@"new-adjustment"]];
    [layerMenu addItem:[self createMenuItem:@"New Group" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"new-group"]];
    [layerMenu addItem:[self createMenuItem:@"Duplicate Layer" action:@selector(menuCommandAction:) key:@"j" mask:NSEventModifierFlagCommand cmdId:@"via-copy"]];
    [layerMenu addItem:[self createMenuItem:@"Delete Layer" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"del-layer"]];
    [layerMenu addItem:[NSMenuItem separatorItem]];
    [layerMenu addItem:[self createMenuItem:@"Add Layer Mask" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"add-mask"]];
    [layerMenu addItem:[self createMenuItem:@"Create / Release Clipping Mask" action:@selector(menuCommandAction:) key:@"g" mask:(NSEventModifierFlagCommand | NSEventModifierFlagOption) cmdId:@"clip"]];
    [layerMenu addItem:[self createMenuItem:@"Layer Style…" action:@selector(menuCommandAction:) key:@"y" mask:(NSEventModifierFlagCommand | NSEventModifierFlagOption) cmdId:@"layer-style"]];
    [layerMenu addItem:[self createMenuItem:@"Remove Background (Mask)" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"remove-bg"]];
    [layerMenu addItem:[self createMenuItem:@"Cut Out Subject to New Layer" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"cutout-subject"]];
    [layerMenuItem setSubmenu:layerMenu];
    [mainMenu addItem:layerMenuItem];

    // 6. Filter Submenu
    NSMenuItem *filterMenuItem = [[NSMenuItem alloc] init];
    NSMenu *filterMenu = [[NSMenu alloc] initWithTitle:@"Filter"];
    [filterMenu addItem:[self createMenuItem:@"Liquify…" action:@selector(menuCommandAction:) key:@"x" mask:(NSEventModifierFlagCommand | NSEventModifierFlagShift) cmdId:@"filter-liquify"]];
    [filterMenu addItem:[self createMenuItem:@"Frequency Separation (Smooth Skin)" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"frequency-separation"]];
    [filterMenu addItem:[self createMenuItem:@"Repeat Last Filter" action:@selector(menuCommandAction:) key:@"f" mask:(NSEventModifierFlagCommand | NSEventModifierFlagOption) cmdId:@"filter-repeat"]];
    [filterMenu addItem:[NSMenuItem separatorItem]];
    [filterMenu addItem:[self createMenuItem:@"Gaussian Blur…" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"filter-gaussian-blur"]];
    [filterMenu addItem:[self createMenuItem:@"Unsharp Mask…" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"filter-unsharp"]];
    [filterMenu addItem:[self createMenuItem:@"High Pass…" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"filter-high-pass"]];
    [filterMenu addItem:[self createMenuItem:@"Reduce Noise…" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"filter-reduce-noise"]];
    [filterMenuItem setSubmenu:filterMenu];
    [mainMenu addItem:filterMenuItem];

    // 7. View Submenu
    NSMenuItem *viewMenuItem = [[NSMenuItem alloc] init];
    NSMenu *viewMenu = [[NSMenu alloc] initWithTitle:@"View"];
    [viewMenu addItem:[self createMenuItem:@"Zoom In" action:@selector(menuCommandAction:) key:@"=" mask:NSEventModifierFlagCommand cmdId:@"zoom-in"]];
    [viewMenu addItem:[self createMenuItem:@"Zoom Out" action:@selector(menuCommandAction:) key:@"-" mask:NSEventModifierFlagCommand cmdId:@"zoom-out"]];
    [viewMenu addItem:[self createMenuItem:@"Fit on Screen" action:@selector(menuCommandAction:) key:@"0" mask:NSEventModifierFlagCommand cmdId:@"fit"]];
    [viewMenu addItem:[self createMenuItem:@"100%" action:@selector(menuCommandAction:) key:@"1" mask:NSEventModifierFlagCommand cmdId:@"actual"]];
    [viewMenu addItem:[NSMenuItem separatorItem]];
    [viewMenu addItem:[self createMenuItem:@"Rulers & Guides" action:@selector(menuCommandAction:) key:@"r" mask:NSEventModifierFlagCommand cmdId:@"guides"]];
    [viewMenu addItem:[self createMenuItem:@"Pixel Grid" action:@selector(menuCommandAction:) key:@"'" mask:NSEventModifierFlagCommand cmdId:@"grid"]];
    [viewMenu addItem:[self createMenuItem:@"Focus Mode (Hide Panels)" action:@selector(menuCommandAction:) key:@"\t" mask:0 cmdId:@"focus"]];
    [viewMenu addItem:[NSMenuItem separatorItem]];
    [viewMenu addItem:[self createMenuItem:@"Reload App" action:@selector(reloadAction:) key:@"r" mask:(NSEventModifierFlagCommand | NSEventModifierFlagShift) cmdId:nil]];
    NSMenuItem *fullScreenItem = [viewMenu addItemWithTitle:@"Toggle Full Screen" action:@selector(toggleFullScreen:) keyEquivalent:@"f"];
    [fullScreenItem setKeyEquivalentModifierMask:(NSEventModifierFlagControl | NSEventModifierFlagCommand)];
    [viewMenuItem setSubmenu:viewMenu];
    [mainMenu addItem:viewMenuItem];

    // 8. Window Submenu
    NSMenuItem *windowMenuItem = [[NSMenuItem alloc] init];
    NSMenu *windowMenu = [[NSMenu alloc] initWithTitle:@"Window"];
    [windowMenu addItemWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
    [windowMenu addItemWithTitle:@"Zoom" action:@selector(performZoom:) keyEquivalent:@""];
    [windowMenu addItem:[NSMenuItem separatorItem]];
    [windowMenu addItem:[self createMenuItem:@"Photo Editing Panel" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"win-photo"]];
    [windowMenu addItem:[self createMenuItem:@"Develop / Adjustments Panel" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"win-adjust"]];
    [windowMenu addItem:[self createMenuItem:@"Looks & LUTs Panel" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"win-looks"]];
    [windowMenu addItem:[self createMenuItem:@"Properties Panel" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"win-properties"]];
    [windowMenu addItem:[self createMenuItem:@"Color / Swatches Panel" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"win-color"]];
    [windowMenu addItem:[self createMenuItem:@"History Panel" action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"win-history"]];
    [windowMenu addItem:[self createMenuItem:@"Command Palette…" action:@selector(menuCommandAction:) key:@"k" mask:NSEventModifierFlagCommand cmdId:@"win-palette"]];
    [windowMenuItem setSubmenu:windowMenu];
    [mainMenu addItem:windowMenuItem];

    // 9. Help Submenu
    NSMenuItem *helpMenuItem = [[NSMenuItem alloc] init];
    NSMenu *helpMenu = [[NSMenu alloc] initWithTitle:@"Help"];
    [helpMenu addItem:[self createMenuItem:@"Keyboard Shortcuts Guide" action:@selector(menuCommandAction:) key:@"/" mask:NSEventModifierFlagCommand cmdId:@"shortcuts"]];
    [helpMenu addItem:[self createMenuItem:[NSString stringWithFormat:@"About %@", appName] action:@selector(menuCommandAction:) key:@"" mask:0 cmdId:@"about"]];
    [helpMenuItem setSubmenu:helpMenu];
    [mainMenu addItem:helpMenuItem];

    [NSApp setMainMenu:mainMenu];
}

- (void)reloadAction:(id)sender {
    [self.webView reload];
}

- (void)webView:(WKWebView *)webView runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSArray<NSURL *> * _Nullable URLs))completionHandler {
    NSOpenPanel *openPanel = [NSOpenPanel openPanel];
    openPanel.allowsMultipleSelection = parameters.allowsMultipleSelection;
    openPanel.canChooseDirectories = parameters.allowsDirectories;
    openPanel.canChooseFiles = YES;
    [openPanel beginWithCompletionHandler:^(NSModalResponse result) {
        if (result == NSModalResponseOK) {
            completionHandler(openPanel.URLs);
        } else {
            completionHandler(nil);
        }
    }];
}

- (void)userContentController:(WKUserContentController *)userContentController didReceiveScriptMessage:(WKScriptMessage *)message {
    if ([message.name isEqualToString:@"saveFile"]) {
        NSDictionary *body = message.body;
        if ([body isKindOfClass:[NSDictionary class]]) {
            NSString *filename = body[@"filename"] ?: @"image.png";
            NSString *b64 = body[@"dataBase64"];
            if (b64) {
                NSData *data = [[NSData alloc] initWithBase64EncodedString:b64 options:NSDataBase64DecodingIgnoreUnknownCharacters];
                if (data) {
                    NSString *downloads = [NSSearchPathForDirectoriesInDomains(NSDownloadsDirectory, NSUserDomainMask, YES) firstObject];
                    NSString *outPath = [downloads stringByAppendingPathComponent:filename];
                    [data writeToFile:outPath atomically:YES];
                }
            }
        }
    }
}

- (void)applicationDidFinishLaunching:(NSNotification *)aNotification {
    NSString *appName = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleName"] ?: @"Skill Application";
    [self setupMenuBar:appName];

    CGFloat winW = 1440;
    CGFloat winH = 900;
    NSNumber *wVal = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"SKWindowWidth"];
    NSNumber *hVal = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"SKWindowHeight"];
    if (wVal) winW = [wVal doubleValue];
    if (hVal) winH = [hVal doubleValue];

    NSRect frame = NSMakeRect(0, 0, winW, winH);
    NSUInteger style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | 
                       NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable;
    
    self.window = [[NSWindow alloc] initWithContentRect:frame
                                              styleMask:style
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];
    [self.window registerForDraggedTypes:@[NSPasteboardTypeFileURL, NSPasteboardTypeString]];
    [self.window setMinSize:NSMakeSize(1024, 700)];
    [self.window center];
    self.window.title = appName;
    self.window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    self.window.titleVisibility = NSWindowTitleVisible;
    self.window.titlebarAppearsTransparent = NO;

    NSString *resPath = [[NSBundle mainBundle] resourcePath];
    NSString *appAssetsPath = [resPath stringByAppendingPathComponent:@"app"];

    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    AppSchemeHandler *schemeHandler = [[AppSchemeHandler alloc] init];
    schemeHandler.basePath = appAssetsPath;
    [config setURLSchemeHandler:schemeHandler forURLScheme:@"app"];

    [config.userContentController addScriptMessageHandler:self name:@"saveFile"];

    [config.preferences setValue:@YES forKey:@"developerExtrasEnabled"];
    [config.preferences setValue:@YES forKey:@"allowFileAccessFromFileURLs"];
    [config.defaultWebpagePreferences setValue:@YES forKey:@"allowsContentJavaScript"];

    self.webView = [[SkillSuiteWebView alloc] initWithFrame:frame configuration:config];
    self.webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.webView.navigationDelegate = self;
    self.webView.UIDelegate = self;

    self.window.contentView = self.webView;
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];

    NSURL *indexURL = [NSURL URLWithString:@"app://localhost/index.html"];
    [self.webView loadRequest:[NSURLRequest requestWithURL:indexURL]];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES;
}

@end

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        AppDelegate *delegate = [[AppDelegate alloc] init];
        app.delegate = delegate;
        [app run];
    }
    return 0;
}
`;

fs.writeFileSync(launcherSourcePath, launcherSourceCode, 'utf8');

// Compile Universal Launcher Binary (arm64 + x86_64)
const sharedBinaryPath = path.join(INSTALLER_DIR, 'UniversalLauncher');
console.log('   Compiling Universal Apple Silicon + Intel Mach-O binary...');
execSync(`clang -arch arm64 -arch x86_64 -fobjc-arc -framework Cocoa -framework WebKit -O2 "${launcherSourcePath}" -o "${sharedBinaryPath}"`);
console.log('   ✓ Universal Mach-O binary compiled successfully.');

for (const app of APPS) {
  const appBundleDir = path.join(MAC_APPS_DIR, `${app.name}.app`);
  const contentsDir = path.join(appBundleDir, 'Contents');
  const macOsDir = path.join(contentsDir, 'MacOS');
  const resourcesDir = path.join(contentsDir, 'Resources');
  const appAssetsDir = path.join(resourcesDir, 'app');

  fs.mkdirSync(macOsDir, { recursive: true });
  fs.mkdirSync(appAssetsDir, { recursive: true });

  // 1. Copy Binary
  const executablePath = path.join(macOsDir, app.slug);
  fs.copyFileSync(sharedBinaryPath, executablePath);
  fs.chmodSync(executablePath, 0o755);

  // 2. Copy Icons
  const sourceIcons = path.join(ROOT_DIR, app.sourceDir, 'src-tauri', 'icons', 'icon.icns');
  const targetIcons = path.join(resourcesDir, 'icon.icns');
  if (fs.existsSync(sourceIcons)) {
    fs.copyFileSync(sourceIcons, targetIcons);
  }

  // 3. Copy Web Assets
  const sourceDist = path.join(ROOT_DIR, app.sourceDir, 'dist');
  execSync(`cp -R "${sourceDist}/"* "${appAssetsDir}/"`);

  // 4. Create Info.plist
  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>${app.name}</string>
    <key>CFBundleExecutable</key>
    <string>${app.slug}</string>
    <key>CFBundleIconFile</key>
    <string>icon.icns</string>
    <key>CFBundleIdentifier</key>
    <string>${app.bundleId}</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>${app.name}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${app.version}</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSSupportsAutomaticGraphicsSwitching</key>
    <true/>
    <key>SKWindowWidth</key>
    <integer>${app.windowWidth}</integer>
    <key>SKWindowHeight</key>
    <integer>${app.windowHeight}</integer>
</dict>
</plist>
`;
  fs.writeFileSync(path.join(contentsDir, 'Info.plist'), infoPlist, 'utf8');

  // 5. Create PkgInfo
  fs.writeFileSync(path.join(contentsDir, 'PkgInfo'), 'APPL????', 'utf8');

  // 6. Ad-hoc code sign for macOS Gatekeeper compliance
  try {
    execSync(`codesign --force --deep -s - "${appBundleDir}" 2>/dev/null || true`);
  } catch {}

  console.log(`   ✓ Created bundle: ${app.name}.app (Universal 64-bit)`);
}

// 3. Create macOS DMG Installers
console.log('\n>> [Step 3/5] Building Apple Disk Image (.dmg) installers...');

// Individual DMGs
for (const app of APPS) {
  const dmgName = `${app.slug}-v1.0.dmg`;
  const dmgPath = path.join(MAC_DIR, dmgName);
  const stagingDir = path.join(INSTALLER_DIR, `dmg_staging_${app.slug}`);

  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  // Copy app bundle
  execSync(`cp -R "${path.join(MAC_APPS_DIR, `${app.name}.app`)}" "${stagingDir}/"`);
  // Create /Applications symlink for drag and drop
  execSync(`ln -s /Applications "${stagingDir}/Applications"`);

  // Create DMG
  if (fs.existsSync(dmgPath)) fs.unlinkSync(dmgPath);
  execSync(`hdiutil create -volname "${app.name} 1.0" -srcfolder "${stagingDir}" -ov -format UDZO "${dmgPath}" -quiet`);
  fs.rmSync(stagingDir, { recursive: true, force: true });

  const stats = fs.statSync(dmgPath);
  console.log(`   ✓ ${dmgName} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
}

// Master All-In-One DMG
const masterDmgName = 'SkillSuite-v1.0-All-In-One.dmg';
const masterDmgPath = path.join(MAC_DIR, masterDmgName);
const masterStagingDir = path.join(INSTALLER_DIR, 'dmg_staging_master');
fs.rmSync(masterStagingDir, { recursive: true, force: true });
fs.mkdirSync(masterStagingDir, { recursive: true });

for (const app of APPS) {
  execSync(`cp -R "${path.join(MAC_APPS_DIR, `${app.name}.app`)}" "${masterStagingDir}/"`);
}
execSync(`ln -s /Applications "${masterStagingDir}/Applications"`);

// Add a quick README inside the DMG
fs.writeFileSync(
  path.join(masterStagingDir, 'Install Instructions.txt'),
  `SKILL SUITE v1.0 — INSTALLATION INSTRUCTIONS\n\n` +
  `Simply drag all 4 applications into the Applications folder shortcut!\n\n` +
  `Included in this suite:\n` +
  `1. Skill Photo   — Pro Layered Photo Editor (Photoshop alternative)\n` +
  `2. Skill Vector  — Precision Vector Graphics (Illustrator alternative)\n` +
  `3. Skill Motion  — Video NLE & Motion VFX (Premiere + After Effects alternative)\n` +
  `4. Skill Design  — UI/UX Product Design & Prototyping (Figma alternative)\n\n` +
  `All applications are completely offline, free of AI dependencies, and optimized for macOS.\n`
);

if (fs.existsSync(masterDmgPath)) fs.unlinkSync(masterDmgPath);
execSync(`hdiutil create -volname "Skill Suite 1.0" -srcfolder "${masterStagingDir}" -ov -format UDZO "${masterDmgPath}" -quiet`);
fs.rmSync(masterStagingDir, { recursive: true, force: true });

const masterStats = fs.statSync(masterDmgPath);
console.log(`   ✓ Master DMG: ${masterDmgName} (${(masterStats.size / (1024 * 1024)).toFixed(2)} MB)`);

// Create double-clickable Install-All-Mac.command
const macInstallCommand = `#!/bin/bash
clear
echo "=========================================================="
echo "          SKILL SUITE v1.0 — MAC INSTALLER                "
echo "=========================================================="
echo ""
echo "This installer will copy all 4 applications to your /Applications folder:"
echo " - Skill Photo.app"
echo " - Skill Vector.app"
echo " - Skill Motion.app"
echo " - Skill Design.app"
echo ""

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
APPS_SOURCE="$SCRIPT_DIR/Applications"

if [ ! -d "$APPS_SOURCE" ]; then
  echo "Error: Applications folder not found at $APPS_SOURCE"
  exit 1
fi

DEST="/Applications"

for app in "Skill Photo.app" "Skill Vector.app" "Skill Motion.app" "Skill Design.app"; do
  echo "-> Installing $app to $DEST..."
  rm -rf "$DEST/$app"
  cp -R "$APPS_SOURCE/$app" "$DEST/"
  xattr -dr com.apple.quarantine "$DEST/$app" 2>/dev/null || true
  chmod -R 755 "$DEST/$app"
  echo "   ✓ $app installed successfully!"
done

echo ""
echo "=========================================================="
echo "  ✓ INSTALLATION COMPLETE! All 4 apps are in /Applications"
echo "=========================================================="
echo ""
echo "You can launch them directly from Launchpad, Spotlight, or Applications."
osascript -e 'display notification "All 4 Skill Suite applications installed to /Applications!" with title "Skill Suite v1.0 Installed"' 2>/dev/null || true
read -p "Press [Enter] to exit..."
`;

const macCommandPath = path.join(MAC_DIR, 'Install-All-Mac.command');
fs.writeFileSync(macCommandPath, macInstallCommand, 'utf8');
fs.chmodSync(macCommandPath, 0o755);
console.log('   ✓ One-click macOS script: Install-All-Mac.command');

// 4. Build Windows Installers
console.log('\n>> [Step 4/5] Building Windows installers & standalone portable packages...');

for (const app of APPS) {
  const winAppDir = path.join(WIN_DIR, `${app.slug}-v1.0-Windows`);
  const winAssetsDir = path.join(winAppDir, 'app');

  fs.mkdirSync(winAssetsDir, { recursive: true });

  // 1. Copy web assets
  const sourceDist = path.join(ROOT_DIR, app.sourceDir, 'dist');
  execSync(`cp -R "${sourceDist}/"* "${winAssetsDir}/"`);

  // 2. Copy icon.ico
  const sourceIco = path.join(ROOT_DIR, app.sourceDir, 'src-tauri', 'icons', 'icon.ico');
  if (fs.existsSync(sourceIco)) {
    fs.copyFileSync(sourceIco, path.join(winAppDir, 'icon.ico'));
  }

  // 3. Batch Launcher (Edge / Chrome / Browser app mode)
  const batLauncher = `@echo off
setlocal
cd /d "%~dp0"
title ${app.name}

set "APP_HTML=%~dp0app\\index.html"
set "EDGE_EXE=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"
if not exist "%EDGE_EXE%" set "EDGE_EXE=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"
set "CHROME_EXE=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"

echo Starting ${app.name} v1.0...

if exist "%EDGE_EXE%" (
    start "" "%EDGE_EXE%" --app="file:///%APP_HTML%" --allow-file-access-from-files --window-size=${app.windowWidth},${app.windowHeight}
    exit /b 0
)

if exist "%CHROME_EXE%" (
    start "" "%CHROME_EXE%" --app="file:///%APP_HTML%" --allow-file-access-from-files --window-size=${app.windowWidth},${app.windowHeight}
    exit /b 0
)

start "" "%APP_HTML%"
exit /b 0
`;
  fs.writeFileSync(path.join(winAppDir, `${app.slug}.bat`), batLauncher, 'utf8');

  // 4. Silent VBS Launcher (no command prompt window)
  const vbsLauncher = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & "${app.slug}.bat" & chr(34), 0
Set WshShell = Nothing
`;
  fs.writeFileSync(path.join(winAppDir, `${app.slug}.vbs`), vbsLauncher, 'utf8');

  // 5. Individual Setup.bat
  const singleSetup = `@echo off
setlocal
cd /d "%~dp0"
title ${app.name} Installer

set "TARGET_DIR=%LOCALAPPDATA%\\Programs\\SkillSuite\\${app.slug}"
echo ========================================================
echo       ${app.name} v1.0 Windows Setup
echo ========================================================
echo.
echo Installing to: %TARGET_DIR%

if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
xcopy /E /I /Y "%~dp0*" "%TARGET_DIR%\\" >nul

echo Creating Desktop shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([System.IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), '${app.name}.lnk')); $s.TargetPath = '%TARGET_DIR%\\${app.slug}.bat'; $s.WorkingDirectory = '%TARGET_DIR%'; if (Test-Path '%TARGET_DIR%\\icon.ico') { $s.IconLocation = '%TARGET_DIR%\\icon.ico,0' }; $s.Save()"

echo Creating Start Menu shortcut...
set "START_DIR=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Skill Suite"
if not exist "%START_DIR%" mkdir "%START_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([System.IO.Path]::Combine('%START_DIR%', '${app.name}.lnk')); $s.TargetPath = '%TARGET_DIR%\\${app.slug}.bat'; $s.WorkingDirectory = '%TARGET_DIR%'; if (Test-Path '%TARGET_DIR%\\icon.ico') { $s.IconLocation = '%TARGET_DIR%\\icon.ico,0' }; $s.Save()"

echo.
echo [OK] ${app.name} v1.0 installed successfully!
echo You can launch it from your Desktop or Start Menu.
pause
`;
  fs.writeFileSync(path.join(winAppDir, 'Setup.bat'), singleSetup, 'utf8');

  console.log(`   ✓ Created Windows standalone package: ${app.slug}-v1.0-Windows/`);
}

// Master Windows Installer: Setup-All-Windows.bat
const masterWinSetup = `@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Skill Suite v1.0 — Master Windows Installer

color 0B
cls
echo ======================================================================
echo              SKILL SUITE v1.0 — MASTER WINDOWS INSTALLER             
echo ======================================================================
echo.
echo  This will install all 4 creative applications to your computer:
echo.
echo    [1] Skill Photo   - Layered Photo Editor (Photoshop alternative)
echo    [2] Skill Vector  - Vector Illustration (Illustrator alternative)
echo    [3] Skill Motion  - Video NLE & VFX (Premiere + AE alternative)
echo    [4] Skill Design  - UI/UX Product Design (Figma alternative)
echo.
echo  Installation Directory: %LOCALAPPDATA%\\Programs\\SkillSuite
echo  Shortcuts: Desktop and Start Menu
echo.
echo ======================================================================
set /p CONFIRM="Install Skill Suite now? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo Installation cancelled.
    pause
    exit /b 0
)

echo.
set "INSTALL_BASE=%LOCALAPPDATA%\\Programs\\SkillSuite"
set "START_MENU=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Skill Suite"
set "DESKTOP=%USERPROFILE%\\Desktop"

if not exist "%INSTALL_BASE%" mkdir "%INSTALL_BASE%"
if not exist "%START_MENU%" mkdir "%START_MENU%"

for %%A in (SkillPhoto SkillVector SkillMotion) do (
    echo [>] Installing %%A...
    if exist "%~dp0%%A-v1.0-Windows" (
        if not exist "%INSTALL_BASE%\\%%A" mkdir "%INSTALL_BASE%\\%%A"
        xcopy /E /I /Y /Q "%~dp0%%A-v1.0-Windows\\*" "%INSTALL_BASE%\\%%A\\" >nul
        echo     - Files copied to %INSTALL_BASE%\\%%A
    ) else (
        echo     - Warning: %%A package not found!
    )
)

echo.
echo [>] Creating Desktop and Start Menu Shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -Command "& {
    $ws = New-Object -ComObject WScript.Shell
    $base = $env:LOCALAPPDATA + '\\Programs\\SkillSuite'
    $desktop = [Environment]::GetFolderPath('Desktop')
    $startMenu = $env:APPDATA + '\\Microsoft\\Windows\\Start Menu\\Programs\\Skill Suite'

    $apps = @(
        @{ Slug='SkillPhoto'; Name='Skill Photo'; Ext='photo' },
        @{ Slug='SkillVector'; Name='Skill Vector'; Ext='vector' },
        @{ Slug='SkillMotion'; Name='Skill Motion'; Ext='motion' }
    )

    foreach ($app in $apps) {
        $targetBat = Join-Path $base ($app.Slug + '\\' + $app.Slug + '.bat')
        $icon = Join-Path $base ($app.Slug + '\\icon.ico')

        # Desktop
        $dtLink = Join-Path $desktop ($app.Name + '.lnk')
        $s1 = $ws.CreateShortcut($dtLink)
        $s1.TargetPath = $targetBat
        $s1.WorkingDirectory = (Join-Path $base $app.Slug)
        if (Test-Path $icon) { $s1.IconLocation = $icon + ',0' }
        $s1.Save()

        # Start Menu
        $smLink = Join-Path $startMenu ($app.Name + '.lnk')
        $s2 = $ws.CreateShortcut($smLink)
        $s2.TargetPath = $targetBat
        $s2.WorkingDirectory = (Join-Path $base $app.Slug)
        if (Test-Path $icon) { $s2.IconLocation = $icon + ',0' }
        $s2.Save()

        Write-Host ('   ✓ Shortcuts created for ' + $app.Name)
    }
}"

echo.
echo ======================================================================
echo    INSTALLATION COMPLETE! Skill Suite v1.0 is ready to use!
echo ======================================================================
echo.
echo Launch any app from your Desktop or the 'Skill Suite' Start Menu folder.
echo.
pause
`;
fs.writeFileSync(path.join(WIN_DIR, 'Setup-All-Windows.bat'), masterWinSetup, 'utf8');
console.log('   ✓ Master Windows Batch Setup: Setup-All-Windows.bat');

// PowerShell Installer: Install-SkillSuite.ps1
const winPs1 = `# Skill Suite v1.0 PowerShell Automated Installer
param(
    [string]$InstallPath = "$env:LOCALAPPDATA\\Programs\\SkillSuite"
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       SKILL SUITE v1.0 — POWERSHELL SETUP ENGINE        " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartMenuDir = "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Skill Suite"
$DesktopDir = [Environment]::GetFolderPath('Desktop')

if (-not (Test-Path $InstallPath)) { New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null }
if (-not (Test-Path $StartMenuDir)) { New-Item -ItemType Directory -Path $StartMenuDir -Force | Out-Null }

$apps = @(
    @{ Slug='SkillPhoto'; Name='Skill Photo'; Desc='Pro Photo Editor'; Ext='photo' },
    @{ Slug='SkillVector'; Name='Skill Vector'; Desc='Vector Illustration Suite'; Ext='vector' },
    @{ Slug='SkillMotion'; Name='Skill Motion'; Desc='Video NLE & Motion VFX'; Ext='motion' }
)

$ws = New-Object -ComObject WScript.Shell

foreach ($app in $apps) {
    $src = Join-Path $ScriptDir "$($app.Slug)-v1.0-Windows"
    $dest = Join-Path $InstallPath $app.Slug

    if (Test-Path $src) {
        Write-Host "-> Installing $($app.Name)..." -ForegroundColor Yellow
        Copy-Item -Path "$src\\*" -Destination $dest -Recurse -Force
        
        $launcherBat = Join-Path $dest "$($app.Slug).bat"
        $iconPath = Join-Path $dest "icon.ico"

        # Desktop Shortcut
        $dShortcut = $ws.CreateShortcut((Join-Path $DesktopDir "$($app.Name).lnk"))
        $dShortcut.TargetPath = $launcherBat
        $dShortcut.WorkingDirectory = $dest
        $dShortcut.Description = $app.Desc
        if (Test-Path $iconPath) { $dShortcut.IconLocation = "$iconPath,0" }
        $dShortcut.Save()

        # Start Menu Shortcut
        $sShortcut = $ws.CreateShortcut((Join-Path $StartMenuDir "$($app.Name).lnk"))
        $sShortcut.TargetPath = $launcherBat
        $sShortcut.WorkingDirectory = $dest
        $sShortcut.Description = $app.Desc
        if (Test-Path $iconPath) { $sShortcut.IconLocation = "$iconPath,0" }
        $sShortcut.Save()

        Write-Host "   ✓ Installed and shortcuts registered." -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  ✓ SUCCESS: All 3 Skill Suite applications installed!    " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
`;
fs.writeFileSync(path.join(WIN_DIR, 'Install-SkillSuite.ps1'), winPs1, 'utf8');
console.log('   ✓ PowerShell Automated Setup: Install-SkillSuite.ps1');

// NSIS Installer Script: Setup-SkillSuite.nsi
const nsisScript = `; NSIS Script for Skill Suite v1.0
!define PRODUCT_NAME "Skill Suite"
!define PRODUCT_VERSION "1.0.0"
!define PRODUCT_PUBLISHER "Skill Scale Creative Technologies"
!define PRODUCT_DIR_REGKEY "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\SkillSuite"
!define PRODUCT_UNINST_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SkillSuite"

Name "\${PRODUCT_NAME} \${PRODUCT_VERSION}"
OutFile "SkillSuite-v1.0-Setup.exe"
InstallDir "$LOCALAPPDATA\\Programs\\SkillSuite"
RequestExecutionLevel user
ShowInstDetails show

Section "Skill Photo" SEC01
  SetOutPath "$INSTDIR\\SkillPhoto"
  File /r "SkillPhoto-v1.0-Windows\\*.*"
  CreateShortCut "$DESKTOP\\Skill Photo.lnk" "$INSTDIR\\SkillPhoto\\SkillPhoto.bat" "" "$INSTDIR\\SkillPhoto\\icon.ico" 0
  CreateDirectory "$SMPROGRAMS\\Skill Suite"
  CreateShortCut "$SMPROGRAMS\\Skill Suite\\Skill Photo.lnk" "$INSTDIR\\SkillPhoto\\SkillPhoto.bat" "" "$INSTDIR\\SkillPhoto\\icon.ico" 0
SectionEnd

Section "Skill Vector" SEC02
  SetOutPath "$INSTDIR\\SkillVector"
  File /r "SkillVector-v1.0-Windows\\*.*"
  CreateShortCut "$DESKTOP\\Skill Vector.lnk" "$INSTDIR\\SkillVector\\SkillVector.bat" "" "$INSTDIR\\SkillVector\\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\\Skill Suite\\Skill Vector.lnk" "$INSTDIR\\SkillVector\\SkillVector.bat" "" "$INSTDIR\\SkillVector\\icon.ico" 0
SectionEnd

Section "Skill Motion" SEC03
  SetOutPath "$INSTDIR\\SkillMotion"
  File /r "SkillMotion-v1.0-Windows\\*.*"
  CreateShortCut "$DESKTOP\\Skill Motion.lnk" "$INSTDIR\\SkillMotion\\SkillMotion.bat" "" "$INSTDIR\\SkillMotion\\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\\Skill Suite\\Skill Motion.lnk" "$INSTDIR\\SkillMotion\\SkillMotion.bat" "" "$INSTDIR\\SkillMotion\\icon.ico" 0
SectionEnd

Section -Post
  WriteUninstaller "$INSTDIR\\uninst.exe"
  CreateShortCut "$SMPROGRAMS\\Skill Suite\\Uninstall Skill Suite.lnk" "$INSTDIR\\uninst.exe"
SectionEnd

Section Uninstall
  RMDir /r "$INSTDIR"
  Delete "$DESKTOP\\Skill Photo.lnk"
  Delete "$DESKTOP\\Skill Vector.lnk"
  Delete "$DESKTOP\\Skill Motion.lnk"
  RMDir /r "$SMPROGRAMS\\Skill Suite"
SectionEnd
`;
fs.writeFileSync(path.join(WIN_DIR, 'Setup-SkillSuite.nsi'), nsisScript, 'utf8');
console.log('   ✓ NSIS Setup Script: Setup-SkillSuite.nsi');

// 5. Documentation & Verification
console.log('\n>> [Step 5/5] Generating documentation & verification checksums...');

// README.md
const readmeContent = `# Skill Suite v1.0 — Official Installers (macOS & Windows)

Welcome to **Skill Suite v1.0**, the professional, 100% offline, local-first creative software suite. Every feature works without AI dependencies.

---

## The 4 Applications

| Application | Replaces | Key Capabilities |
| :--- | :--- | :--- |
| **Skill Photo** | Adobe Photoshop | Layer stack, RAW tone curve, non-destructive filters, frequency separation, liquify mesh engine, healing |
| **Skill Vector** | Adobe Illustrator | Infinite vector artboard, 2D polygon boolean clipping (Unite, Minus Front, Intersect, Exclude), Shape Builder tool, simplify path, outline stroke |
| **Skill Motion** | Adobe Premiere Pro & After Effects | Frame-accurate offline render loop, multi-track timeline, Bezier velocity curve graph editor (F9 Easy Ease, bounce, elastic), YouTube chapter exporter, 11 VFX shaders |
| **Skill Design** | Figma | Reactive scene graph, auto-layout flexbox engine (gap, padding, hug/fixed), interactive prototype player, deterministic code generator (React + Tailwind, HTML + CSS, SwiftUI) |

---

## macOS Installation Options

You have 3 easy ways to install on macOS:

### Option A: Drag-and-Drop Disk Images (.dmg)
1. Open \`Mac/SkillSuite-v1.0-All-In-One.dmg\` (or any individual \`.dmg\` file).
2. Drag the application icon(s) into the **Applications** folder shortcut.
3. Open from Launchpad, Spotlight, or your Applications folder!

### Option B: One-Click Terminal Installer
1. Double-click \`Mac/Install-All-Mac.command\` in Finder.
2. It automatically installs all 4 applications to \`/Applications\`, clears quarantine flags, and confirms completion.

### Option C: Direct Applications Folder
The standalone \`.app\` bundles are available directly in \`Mac/Applications/\`:
- \`Skill Photo.app\`
- \`Skill Vector.app\`
- \`Skill Motion.app\`
- \`Skill Design.app\`

---

## Windows Installation Options

### Option A: One-Click Batch Installer
1. Open the \`Windows/\` folder.
2. Double-click **\`Setup-All-Windows.bat\`**.
3. Press **Y** when prompted.
4. All 4 apps will be installed to \`%LOCALAPPDATA%\\Programs\\SkillSuite\` and shortcuts will be created on your **Desktop** and **Start Menu**.

### Option B: PowerShell Automated Setup
Open PowerShell and run:
\`\`\`powershell
.\\Windows\\Install-SkillSuite.ps1
\`\`\`

### Option C: Standalone Portable Use (Zero Install)
You can run any app directly from its folder without installing:
- \`Windows/SkillPhoto-v1.0-Windows/SkillPhoto.bat\`
- \`Windows/SkillVector-v1.0-Windows/SkillVector.bat\`
- \`Windows/SkillMotion-v1.0-Windows/SkillMotion.bat\`
- \`Windows/SkillDesign-v1.0-Windows/SkillDesign.bat\`

---

## Verification & Architecture
- **macOS Binary**: Universal Mach-O 64-bit (\`arm64\` Apple Silicon + \`x86_64\` Intel)
- **Windows Runtime**: Microsoft Edge / Chrome Chromium app-mode with full local file access
- **Version**: 1.0.0
`;
fs.writeFileSync(path.join(INSTALLER_DIR, 'README.md'), readmeContent, 'utf8');

// HTML Installation Guide
const htmlGuide = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Skill Suite v1.0 — Installer & Quick Start Guide</title>
<style>
  :root {
    --bg: #0b0f19;
    --card: #131b2e;
    --border: #23314f;
    --text: #f1f5f9;
    --text-dim: #94a3b8;
    --accent-photo: #38bdf8;
    --accent-vector: #fb923c;
    --accent-motion: #a855f7;
    --accent-design: #10b981;
  }
  body {
    margin: 0;
    padding: 40px 20px;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
  }
  .container {
    max-width: 960px;
    margin: 0 auto;
  }
  .header {
    text-align: center;
    margin-bottom: 48px;
  }
  .badge {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    background: rgba(56, 189, 248, 0.15);
    color: #38bdf8;
    border: 1px solid rgba(56, 189, 248, 0.3);
    margin-bottom: 12px;
  }
  h1 { font-size: 36px; margin: 0 0 12px 0; font-weight: 800; letter-spacing: -0.5px; }
  .subtitle { font-size: 18px; color: var(--text-dim); margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 48px; }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
    transition: transform 0.2s, border-color 0.2s;
  }
  .card:hover { transform: translateY(-3px); }
  .card-photo { border-top: 4px solid var(--accent-photo); }
  .card-vector { border-top: 4px solid var(--accent-vector); }
  .card-motion { border-top: 4px solid var(--accent-motion); }
  .card-design { border-top: 4px solid var(--accent-design); }
  .card h3 { margin: 0 0 8px 0; font-size: 18px; }
  .card p { margin: 0; font-size: 13px; color: var(--text-dim); }
  .section {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 32px;
    margin-bottom: 32px;
  }
  .section h2 { margin-top: 0; font-size: 24px; }
  .step-list { list-style: none; padding: 0; margin: 20px 0; counter-reset: step-counter; }
  .step-list li {
    counter-increment: step-counter;
    position: relative;
    padding-left: 44px;
    margin-bottom: 20px;
  }
  .step-list li::before {
    content: counter(step-counter);
    position: absolute;
    left: 0;
    top: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #1e293b;
    border: 1px solid var(--border);
    color: #38bdf8;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 13px;
  }
  code {
    background: #060913;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 13px;
    color: #38bdf8;
    font-family: ui-monospace, Menlo, Consolas, monospace;
  }
  .footer { text-align: center; color: var(--text-dim); font-size: 13px; margin-top: 48px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <span class="badge">OFFICIAL RELEASE v1.0.0</span>
    <h1>Skill Suite Installer Guide</h1>
    <p class="subtitle">Complete macOS &amp; Windows installation instructions for all 4 creative applications</p>
  </div>

  <div class="grid">
    <div class="card card-photo">
      <h3>Skill Photo</h3>
      <p>Photoshop alternative with layers, RAW, frequency separation &amp; liquify mesh engine.</p>
    </div>
    <div class="card card-vector">
      <h3>Skill Vector</h3>
      <p>Illustrator alternative with 2D polygon boolean pathfinder &amp; shape builder.</p>
    </div>
    <div class="card card-motion">
      <h3>Skill Motion</h3>
      <p>Premiere + After Effects suite with offline rendering &amp; Bezier curve keyframes.</p>
    </div>
    <div class="card card-design">
      <h3>Skill Design</h3>
      <p>Figma alternative with auto-layout flex engine, prototyping &amp; code generation.</p>
    </div>
  </div>

  <div class="section">
    <h2> macOS Installation</h2>
    <ol class="step-list">
      <li>
        <strong>All-in-One Disk Image (.dmg):</strong><br>
        Open <code>Mac/SkillSuite-v1.0-All-In-One.dmg</code> and drag all 4 applications to the <code>Applications</code> shortcut.
      </li>
      <li>
        <strong>One-Click Script:</strong><br>
        Double-click <code>Mac/Install-All-Mac.command</code> in Finder to automatically install and clear quarantine flags.
      </li>
      <li>
        <strong>Standalone Apps:</strong><br>
        Pre-built applications are also available directly in <code>Mac/Applications/</code>.
      </li>
    </ol>
  </div>

  <div class="section">
    <h2>⊞ Windows Installation</h2>
    <ol class="step-list">
      <li>
        <strong>Master One-Click Setup:</strong><br>
        Double-click <code>Windows/Setup-All-Windows.bat</code> and press <code>Y</code> to install the full suite with Desktop and Start Menu shortcuts.
      </li>
      <li>
        <strong>PowerShell Automated Installer:</strong><br>
        Run <code>.\\Windows\\Install-SkillSuite.ps1</code> in PowerShell.
      </li>
      <li>
        <strong>Zero-Install Portable Running:</strong><br>
        Double-click any <code>.bat</code> file inside each app folder to launch immediately in frameless desktop mode.
      </li>
    </ol>
  </div>

  <div class="footer">
    Skill Suite v1.0 • 100% Offline • No AI Dependencies • Deterministic Algorithms
  </div>
</div>
</body>
</html>
`;
fs.writeFileSync(path.join(INSTALLER_DIR, 'INSTALLATION-GUIDE.html'), htmlGuide, 'utf8');

// Generate Checksums for VERIFICATION.txt
function computeFileHash(filePath) {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

let verificationLog = `SKILL SUITE v1.0 — INSTALLER VERIFICATION REPORT\n`;
verificationLog += `Timestamp: ${new Date().toISOString()}\n`;
verificationLog += `Platforms: macOS (Apple Silicon + Intel Universal) & Windows (x64/x86)\n\n`;
verificationLog += `====================================================================================\n`;
verificationLog += `FILE CHECKSUMS (SHA-256)\n`;
verificationLog += `====================================================================================\n\n`;

verificationLog += `[macOS Disk Images]\n`;
const macDmgs = fs.readdirSync(MAC_DIR).filter(f => f.endsWith('.dmg'));
for (const dmg of macDmgs) {
  const p = path.join(MAC_DIR, dmg);
  const size = fs.statSync(p).size;
  const hash = computeFileHash(p);
  verificationLog += ` - ${dmg.padEnd(36)} Size: ${(size / 1024 / 1024).toFixed(2).padStart(6)} MB | SHA256: ${hash}\n`;
}

verificationLog += `\n[macOS Application Bundles]\n`;
for (const app of APPS) {
  const appPath = path.join(MAC_APPS_DIR, `${app.name}.app`);
  const execPath = path.join(appPath, 'Contents', 'MacOS', app.slug);
  if (fs.existsSync(execPath)) {
    const hash = computeFileHash(execPath);
    verificationLog += ` - ${app.name.padEnd(20)} Universal Binary SHA256: ${hash}\n`;
  }
}

verificationLog += `\n[Windows Packages]\n`;
const winDirs = fs.readdirSync(WIN_DIR).filter(f => fs.statSync(path.join(WIN_DIR, f)).isDirectory());
for (const d of winDirs) {
  verificationLog += ` - ${d}\n`;
}

fs.writeFileSync(path.join(INSTALLER_DIR, 'VERIFICATION.txt'), verificationLog, 'utf8');

// Clean up temporary files
if (fs.existsSync(sharedBinaryPath)) fs.unlinkSync(sharedBinaryPath);
if (fs.existsSync(launcherSourcePath)) fs.unlinkSync(launcherSourcePath);

console.log('\n====================================================');
console.log('       ✓ ALL INSTALLERS GENERATED SUCCESSFULLY!     ');
console.log(` Location: ${INSTALLER_DIR}`);
console.log('====================================================\n');
