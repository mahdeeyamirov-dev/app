import SwiftUI

struct RootView: View {
    var body: some View {
        TabView {
            ContentView()
                .tabItem { Label("Мои привычки", systemImage: "checklist") }

            DashboardView()
                .tabItem { Label("Дашборд", systemImage: "person.3") }
        }
        .frame(minWidth: 480, minHeight: 520)
    }
}

#Preview {
    RootView()
        .environmentObject(HabitStore())
}
