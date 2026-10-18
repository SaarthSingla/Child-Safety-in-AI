import { StyleSheet, Text, View, Pressable } from 'react-native';
import { router } from 'expo-router';

export default function GetCredentialScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.logo}>ChildSafe</Text>

      <View style={styles.content}>
        <Text style={styles.title}>Age Credential</Text>

        <Text style={styles.heading}>Why verify your age?</Text>

        <Text style={styles.body}>
          ChildSafe creates a privacy-preserving age credential that lets you
          prove your age category without sharing unnecessary personal
          information with a verifier.
        </Text>

        <Text style={styles.body}>
          Your credential contains an age band and verification information,
          rather than your original selfie.
        </Text>

        <Pressable
          style={styles.button}
          onPress={() => router.push('/camera')}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F8FA',
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  logo: {
    fontSize: 30,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 80,
  },
  title: {
    fontSize: 17,
    color: '#666',
    marginBottom: 8,
  },
  heading: {
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 20,
  },
  body: {
    fontSize: 17,
    lineHeight: 25,
    color: '#555',
    marginBottom: 18,
  },
  button: {
    backgroundColor: '#111',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 18,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '600',
  },
});
