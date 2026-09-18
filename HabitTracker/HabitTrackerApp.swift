import SwiftUI

@main
struct HabitTrackerApp: App {
    @StateObject private var store = HabitStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
        }
        .windowResizability(.contentSize)
    }
}
